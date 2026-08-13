import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

Deno.serve(withAuth(async (_req, ctx) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Connect to ERP
    const erpUrl = Deno.env.get("ERP_BASE_URL")!;
    const erpServiceKey = Deno.env.get("ERP_SERVICE_ROLE_KEY")!;

    if (!erpUrl || !erpServiceKey) {
      return new Response(JSON.stringify({ error: "ERP credentials not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const erp = createClient(erpUrl, erpServiceKey);

    // 1. List admin users from ERP
    const { data: erpAdminRoles, error: rolesError } = await erp
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (rolesError) {
      console.error("Error reading ERP user_roles:", rolesError);
      return new Response(JSON.stringify({ error: "Failed to read ERP admins" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!erpAdminRoles?.length) {
      return new Response(JSON.stringify({ imported: 0, skipped: 0, errors: [], message: "No admins found in ERP" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminUserIds = erpAdminRoles.map((r: any) => r.user_id);

    // 2. Get profiles from ERP
    const { data: erpProfiles, error: profilesError } = await erp
      .from("profiles")
      .select("id, full_name, email, cpf, phone")
      .in("id", adminUserIds);

    if (profilesError) {
      console.error("Error reading ERP profiles:", profilesError);
      return new Response(JSON.stringify({ error: "Failed to read ERP profiles" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const gProfile of (erpProfiles || [])) {
      try {
        if (!gProfile.email && !gProfile.cpf) {
          errors.push(`Admin ${gProfile.id}: sem email ou CPF`);
          continue;
        }

        // Check if user exists locally by CPF or email
        let existingProfile: any = null;

        if (gProfile.cpf) {
          const { data } = await supabase
            .from("profiles")
            .select("id")
            .eq("cpf", gProfile.cpf)
            .maybeSingle();
          existingProfile = data;
        }

        if (!existingProfile && gProfile.email) {
          const { data } = await supabase
            .from("profiles")
            .select("id")
            .eq("email", gProfile.email)
            .maybeSingle();
          existingProfile = data;
        }

        if (existingProfile) {
          // Check if already admin
          const { data: alreadyAdmin } = await supabase.rpc("has_role", {
            _user_id: existingProfile.id,
            _role: "admin",
          });

          if (alreadyAdmin) {
            skipped++;
          } else {
            // Add admin role
            await supabase.from("user_roles").insert({
              user_id: existingProfile.id,
              role: "admin",
              scope_access: "global",
            });
            imported++;

            await supabase.from("activity_logs").insert({
              user_id: ctx.userId,
              action: "erp_admin_role_added",
              module: "migration",
              details: {
                target_user_id: existingProfile.id,
                cpf: gProfile.cpf,
                source: "import-erp-admins",
              },
            });
          }
        } else {
          // Create new user
          const tempPassword = `GA_${(gProfile.cpf || "").replace(/\D/g, "").slice(-6)}_${Date.now().toString(36)}`;

          const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email: gProfile.email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              full_name: gProfile.full_name,
              cpf: gProfile.cpf,
              phone: gProfile.phone,
              origin: "erp_admin_import",
            },
          });

          if (createError) {
            errors.push(`${gProfile.email || gProfile.cpf}: ${createError.message}`);
            continue;
          }

          // The trigger handle_new_user creates profile + candidato role automatically.
          // Update profile with ERP data and add admin role.
          const newUserId = newUser.user.id;

          await supabase.from("profiles").update({
            full_name: gProfile.full_name || "",
            cpf: gProfile.cpf,
            phone: gProfile.phone,
          }).eq("id", newUserId);

          await supabase.from("user_roles").insert({
            user_id: newUserId,
            role: "admin",
            scope_access: "global",
          });

          imported++;

          await supabase.from("activity_logs").insert({
            user_id: ctx.userId,
            action: "erp_admin_imported",
            module: "migration",
            details: {
              new_user_id: newUserId,
              email: gProfile.email,
              cpf: gProfile.cpf,
              source: "import-erp-admins",
            },
          });
        }
      } catch (err) {
        console.error(`Error processing admin ${gProfile.id}:`, err);
        errors.push(`${gProfile.email || gProfile.cpf}: ${(err as Error).message}`);
      }
    }

    // Log summary
    await supabase.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "erp_admin_import_completed",
      module: "migration",
      details: { imported, skipped, errors_count: errors.length },
    });

    return new Response(
      JSON.stringify({ imported, skipped, errors_count: errors.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("import-erp-admins error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
