import { corsHeaders } from "../_shared/cors.ts";
import { withAuth, AuthenticatedRequestContext } from "../_shared/with-auth.ts";

interface CleanupRequest {
  email?: string;
  cpf?: string;
}

function normalizeEmail(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeCPF(value: string | undefined | null) {
  return (value ?? "").replace(/\D/g, "");
}

const handler = async (req: Request, ctx: AuthenticatedRequestContext): Promise<Response> => {
  try {
    const body = (await req.json()) as CleanupRequest;
    const email = normalizeEmail(body.email);
    const cpf = normalizeCPF(body.cpf);

    if (!email && !cpf) {
      return new Response(JSON.stringify({ ok: false, error: "email_ou_cpf_obrigatorio" }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const admin = ctx.admin;
    const authMatches: Array<{ id: string; email: string | null }> = [];
    const userIds = new Set<string>();

    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message, stage: "list_auth_users" }), {
          status: 200,
          headers: corsHeaders,
        });
      }

      const users = data.users ?? [];
      for (const user of users) {
        const userEmail = normalizeEmail(user.email);
        const userCpf = normalizeCPF(
          String(
            user.user_metadata?.cpf ??
            user.app_metadata?.cpf ??
            user.raw_user_meta_data?.cpf ??
            "",
          ),
        );

        if ((email && userEmail === email) || (cpf && userCpf === cpf)) {
          authMatches.push({ id: user.id, email: user.email ?? null });
          userIds.add(user.id);
        }
      }

      if (users.length < 200) break;
    }

    const deleted = {
      authUsers: [] as string[],
      candidateProfiles: [] as string[],
      userRoles: [] as string[],
      candidates: [] as string[],
    };

    if (userIds.size > 0) {
      const ids = Array.from(userIds);

      const { data: deletedProfilesById } = await admin
        .from("candidate_profiles")
        .delete()
        .in("candidate_id", ids)
        .select("candidate_id");
      deleted.candidateProfiles.push(...(deletedProfilesById ?? []).map((row) => row.candidate_id));

      const { data: deletedRoles } = await admin
        .from("user_roles")
        .delete()
        .in("user_id", ids)
        .select("user_id");
      deleted.userRoles.push(...(deletedRoles ?? []).map((row) => row.user_id));

      const { data: deletedCandidatesById } = await admin
        .from("candidates")
        .delete()
        .in("id", ids)
        .select("id");
      deleted.candidates.push(...(deletedCandidatesById ?? []).map((row) => row.id));
    }

    if (email) {
      const { data: deletedProfilesByEmail } = await admin
        .from("candidate_profiles")
        .delete()
        .eq("email", email)
        .select("candidate_id");
      deleted.candidateProfiles.push(...(deletedProfilesByEmail ?? []).map((row) => row.candidate_id));

      const { data: deletedCandidatesByEmail } = await admin
        .from("candidates")
        .delete()
        .eq("email", email)
        .select("id");
      deleted.candidates.push(...(deletedCandidatesByEmail ?? []).map((row) => row.id));
    }

    if (cpf) {
      const { data: deletedCandidatesByCpf } = await admin
        .from("candidates")
        .delete()
        .eq("cpf", cpf)
        .select("id");
      deleted.candidates.push(...(deletedCandidatesByCpf ?? []).map((row) => row.id));
    }

    for (const match of authMatches) {
      const { error } = await admin.auth.admin.deleteUser(match.id);
      if (!error) {
        deleted.authUsers.push(match.id);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      email,
      cpf,
      foundAuthUsers: authMatches,
      deleted: {
        authUsers: Array.from(new Set(deleted.authUsers)),
        candidateProfiles: Array.from(new Set(deleted.candidateProfiles)),
        userRoles: Array.from(new Set(deleted.userRoles)),
        candidates: Array.from(new Set(deleted.candidates)),
      },
    }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "cleanup_failed",
    }), {
      status: 200,
      headers: corsHeaders,
    });
  }
};

Deno.serve(withAuth(handler, { allowedRoles: ["admin", "rh_franqueadora"] }));
