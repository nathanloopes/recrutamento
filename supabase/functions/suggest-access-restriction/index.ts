import { withAuth } from "../_shared/with-auth.ts";

const corsHeadersFallback = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const headers = { ...corsHeadersFallback, "Content-Type": "application/json" };

Deno.serve(withAuth(async (req, ctx) => {
  try {
    const { user_id } = await req.json().catch(() => ({}));
    const supabase = ctx.admin;

    const suggestions: Array<{ type: string; severity: string; suggestion: string; context: Record<string, any> }> = [];

    // 1. Check for users with global scope who could be regional
    const { data: globalUsers } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("scope_access", "global")
      .not("role", "eq", "admin");
    
    if (globalUsers?.length) {
      for (const gu of globalUsers) {
        suggestions.push({
          type: "scope_reduction",
          severity: "medium",
          suggestion: `Usuário com role "${gu.role}" possui escopo global. Considere restringir para regional ou unidade para seguir o princípio do menor privilégio.`,
          context: { user_id: gu.user_id, role: gu.role },
        });
      }
    }

    // 2. Check for users with multiple admin-level roles
    const { data: multiRoleUsers } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "rh_franqueadora", "auditor_admin"] as any);
    
    const roleCountMap = new Map<string, string[]>();
    multiRoleUsers?.forEach((r: any) => {
      const roles = roleCountMap.get(r.user_id) || [];
      roles.push(r.role);
      roleCountMap.set(r.user_id, roles);
    });
    
    roleCountMap.forEach((roles, uid) => {
      if (roles.length > 1) {
        suggestions.push({
          type: "excessive_roles",
          severity: "high",
          suggestion: `Usuário possui múltiplas roles administrativas (${roles.join(", ")}). Isso pode representar um risco de segregação de funções.`,
          context: { user_id: uid, roles },
        });
      }
    });

    // 3. Check for inactive users with active roles
    const { data: inactiveWithRoles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin"] as any);
    
    if (inactiveWithRoles?.length) {
      const userIds = [...new Set(inactiveWithRoles.map((r: any) => r.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, is_active, full_name")
        .in("id", userIds)
        .eq("is_active", false);
      
      profiles?.forEach((p: any) => {
        suggestions.push({
          type: "inactive_with_roles",
          severity: "critical",
          suggestion: `Usuário "${p.full_name}" está inativo mas ainda possui roles administrativas. Remova as roles para evitar acesso indevido.`,
          context: { user_id: p.id, full_name: p.full_name },
        });
      });
    }

    // Log execution
    await supabase.from("activity_logs").insert({
      action: "ai_suggest_restriction_executed",
      module: "ia_governance",
      details: { suggestions_count: suggestions.length, target_user_id: user_id || null },
    });

    return new Response(
      JSON.stringify({
        success: true,
        suggestions_count: suggestions.length,
        suggestions,
      }),
      { headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora", "auditor_admin"] }));
