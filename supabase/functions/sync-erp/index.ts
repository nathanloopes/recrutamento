import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuth(async (req, ctx) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    const { migration_id } = await req.json();
    if (!migration_id) {
      return new Response(JSON.stringify({ error: "migration_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load migration data from THIS project
    const { data: migration, error: mErr } = await supabase
      .from("migration_logs")
      .select("*, profiles:candidate_id(full_name, email, phone, cpf, city, state), units:unit_id(name, code), jobs:job_id(title)")
      .eq("id", migration_id)
      .single();

    if (mErr || !migration) {
      return new Response(JSON.stringify({ error: "Migration not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profile = (migration as any).profiles;
    const unit = (migration as any).units;
    const job = (migration as any).jobs;

    if (!profile?.email || !profile?.cpf) {
      return new Response(JSON.stringify({ error: "Candidato sem email ou CPF" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === ERP SUPABASE CLIENT ===
    const erpUrl = Deno.env.get("ERP_BASE_URL")!;
    const erpServiceKey = Deno.env.get("ERP_SERVICE_ROLE_KEY")!;

    if (!erpUrl || !erpServiceKey) {
      throw new Error("ERP Supabase credentials not configured");
    }

    const erp = createClient(erpUrl, erpServiceKey);

    // 1. Create auth user in ERP
    const tempPassword = `CP_${profile.cpf.replace(/\D/g, "").slice(-6)}_${Date.now().toString(36)}`;
    
    const { data: erpUser, error: createUserError } = await erp.auth.admin.createUser({
      email: profile.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: profile.full_name,
        cpf: profile.cpf,
        phone: profile.phone,
        origin: "recrutamento_cp",
        migration_id,
      },
    });

    if (createUserError) {
      // If user already exists, try to find them
      if (createUserError.message?.includes("already been registered") || createUserError.message?.includes("already exists")) {
        console.log("User already exists in ERP, looking up by email...");
        
        const { data: existingUsers } = await erp.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find((u: any) => u.email === profile.email);
        
        if (existingUser) {
          // Update migration as completed with existing user
          await supabase
            .from("migration_logs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              notes: `Usuário já existia no ERP. ID: ${existingUser.id}`,
            })
            .eq("id", migration_id);

          await supabase.from("activity_logs").insert({
            user_id: ctx.userId,
            action: "erp_sync_existing_user",
            module: "migration",
            details: { migration_id, erp_user_id: existingUser.id },
          });

          return new Response(
            JSON.stringify({ success: true, erp_user_id: existingUser.id, already_existed: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      console.error("ERP createUser error:", createUserError);
      await supabase
        .from("migration_logs")
        .update({
          status: "failed",
          notes: `Falha ao criar usuário no ERP: ${createUserError.message}`,
        })
        .eq("id", migration_id);

      return new Response(
        JSON.stringify({ success: false, error: "Failed to create user in external system" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const erpUserId = erpUser.user.id;

    // 2. Insert/update profile in ERP's profiles table
    const { error: profileError } = await erp
      .from("profiles")
      .upsert({
        id: erpUserId,
        full_name: profile.full_name,
        email: profile.email,
        cpf: profile.cpf,
        phone: profile.phone,
        city: profile.city,
        state: profile.state,
      }, { onConflict: "id" });

    if (profileError) {
      console.error("ERP profile insert error:", profileError);
      // User was created but profile failed - log but don't fail entirely
    }

    // 2b. Assign RBAC role in ERP's user_roles table
    // Read allowed_roles from CrossConfig to determine target role
    let targetRole = "colaborador";
    const { data: migrationLog } = await supabase
      .from("migration_logs")
      .select("target_role")
      .eq("id", migration_id)
      .single();
    if (migrationLog?.target_role) {
      targetRole = migrationLog.target_role;
    } else {
      // Fallback: read from CrossConfig allowed_roles
      const { data: allowedRolesConfig } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "migration")
        .eq("key", "allowed_roles")
        .maybeSingle();
      if (allowedRolesConfig?.value) {
        const roles = Array.isArray(allowedRolesConfig.value)
          ? allowedRolesConfig.value
          : typeof allowedRolesConfig.value === "string"
            ? JSON.parse(allowedRolesConfig.value)
            : ["colaborador"];
        targetRole = roles[0] || "colaborador";
      }
    }
    const { error: roleError } = await erp
      .from("user_roles")
      .insert({
        user_id: erpUserId,
        role: targetRole,
      });

    if (roleError) {
      console.error("ERP role assign error:", roleError);
    }

    // 3. Update migration status in THIS project
    const synced = !profileError;
    await supabase
      .from("migration_logs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        notes: synced
          ? `Sincronizado com ERP. User ID: ${erpUserId}. Senha temporária gerada.`
          : `Usuário criado no ERP (${erpUserId}) mas perfil teve erro: ${profileError?.message}`,
      })
      .eq("id", migration_id);

    // 4. Log activity
    await supabase.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "erp_sync_success",
      module: "migration",
      details: { migration_id, erp_user_id: erpUserId, profile_synced: synced },
    });

    return new Response(
      JSON.stringify({
        success: true,
        erp_user_id: erpUserId,
        profile_synced: synced,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sync-erp error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
