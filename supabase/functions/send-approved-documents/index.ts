import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

Deno.serve(
  withAuth(
    async (req, ctx) => {
      const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
      if (!BREVO_API_KEY) {
        return new Response(
          JSON.stringify({ error: "Email service not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { requestId } = await req.json();
      if (!requestId || typeof requestId !== "string") {
        return new Response(
          JSON.stringify({ error: "requestId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { admin, userId } = ctx;

      // 1. Buscar a solicitação de documentos com dados relacionados
      const { data: request, error: reqError } = await admin
        .from("document_requests")
        .select(
          "*, profiles:candidate_id(id, full_name, email, phone), jobs:job_id(title), units:unit_id(name)",
        )
        .eq("id", requestId)
        .single();

      if (reqError || !request) {
        return new Response(
          JSON.stringify({ error: "Document request not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 2. Validar email do candidato (vem do cadastro — não é digitado pelo usuário)
      const candidateProfile = (request as any).profiles;
      const candidateEmail: string = candidateProfile?.email || "";
      const candidateName: string = candidateProfile?.full_name || "Candidato";
      const candidateId: string = candidateProfile?.id || "";

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!candidateEmail || !emailRegex.test(candidateEmail)) {
        return new Response(
          JSON.stringify({ error: "Candidate email is missing or invalid" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 3. Buscar todos os uploads aprovados para esta solicitação
      const { data: uploads, error: uploadsError } = await admin
        .from("document_uploads")
        .select("id, document_type, file_url, uploaded_at, status")
        .eq("request_id", requestId)
        .eq("status", "approved")
        .order("uploaded_at", { ascending: false });

      if (uploadsError) {
        console.error("Error fetching uploads:", uploadsError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch document uploads" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Dedup: manter apenas o upload aprovado mais recente por tipo de documento
      const latestByType: Record<string, any> = {};
      for (const u of (uploads || [])) {
        if (!latestByType[(u as any).document_type]) {
          latestByType[(u as any).document_type] = u;
        }
      }
      const approvedUploads = Object.values(latestByType);

      if (approvedUploads.length === 0) {
        return new Response(
          JSON.stringify({ error: "No approved documents found" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 4. Verificar se TODOS os documentos obrigatórios estão aprovados
      const allDocs: string[] = [
        ...((request.documents_list as string[]) || []),
        ...((request.custom_documents as string[]) || []),
      ];

      const approvedTypes = new Set(approvedUploads.map((u: any) => u.document_type));
      const missingDocs = allDocs.filter((d) => !approvedTypes.has(d));

      if (missingDocs.length > 0) {
        return new Response(
          JSON.stringify({
            error: "Not all documents are approved",
            missing: missingDocs,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 5. Gerar URLs assinadas para cada documento (válidas por 7 dias)
      const signedLinks: Array<{ name: string; url: string }> = [];
      for (const u of approvedUploads) {
        const { data: signed, error: signErr } = await admin.storage
          .from("documents")
          .createSignedUrl((u as any).file_url, 60 * 60 * 24 * 7);

        if (signErr || !signed?.signedUrl) {
          console.warn(`Failed to generate signed URL for ${(u as any).document_type}:`, signErr);
          continue;
        }
        signedLinks.push({ name: (u as any).document_type, url: signed.signedUrl });
      }

      if (signedLinks.length === 0) {
        return new Response(
          JSON.stringify({ error: "Failed to generate download links" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const jobTitle: string = (request as any).jobs?.title || "Vaga";
      const unitName: string = (request as any).units?.name || "Unidade";
      const sentAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

      // 6. Montar HTML do email
      const docsListHtml = signedLinks
        .map(
          (l) =>
            `<li style="margin-bottom:10px;">
              <strong>${l.name}</strong><br/>
              <a href="${l.url}" target="_blank" style="color:#1a56db;font-size:13px;">
                Clique aqui para baixar
              </a>
              <span style="font-size:11px;color:#888;"> — link válido por 7 dias</span>
            </li>`,
        )
        .join("");

      const htmlContent = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">
          <div style="background:#1a56db;padding:24px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;">✅ Documentação Aprovada</h1>
            <p style="color:#c7d8ff;margin:8px 0 0 0;font-size:14px;">Grupo Recruta — Recursos Humanos</p>
          </div>
          <div style="padding:28px 24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:16px;">Olá, <strong>${candidateName}</strong>!</p>
            <p>Sua documentação para a vaga de <strong>${jobTitle}</strong> na unidade <strong>${unitName}</strong>
            foi analisada e <strong>todos os documentos estão aprovados</strong>.</p>
            <p style="margin-top:20px;font-weight:600;font-size:15px;">📄 Documentos aprovados (${signedLinks.length}):</p>
            <ul style="margin:12px 0;padding-left:20px;line-height:1.8;">
              ${docsListHtml}
            </ul>
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:14px;margin-top:24px;">
              <p style="margin:0;color:#166534;font-size:13px;">
                🔒 Os links de download são seguros e expiram automaticamente em 7 dias a partir de ${sentAt}.
              </p>
            </div>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0 16px;" />
            <p style="font-size:12px;color:#aaa;margin:0;">
              Este email foi gerado automaticamente pelo sistema de RH do Grupo Recruta.
              Por favor, não responda a este email.
            </p>
          </div>
        </div>
      `;

      const textContent =
        `Olá ${candidateName}, sua documentação para a vaga de ${jobTitle} (${unitName}) foi aprovada. ` +
        `Documentos: ${signedLinks.map((l) => l.name).join(", ")}. ` +
        `Acesse o email em formato HTML para baixar seus documentos.`;

      // 7. Enviar via Brevo
      const brevoPayload = {
        sender: { name: "Recruta - RH", email: "rh@example.com" },
        to: [{ email: candidateEmail, name: candidateName }],
        subject: `Documentação Aprovada — ${jobTitle} — ${unitName}`,
        htmlContent,
        textContent,
      };

      const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(brevoPayload),
      });

      const brevoResult = await brevoResponse.json();
      const delivered = brevoResponse.ok;

      // 8b. Send WhatsApp notification if candidate has phone
      const candidatePhone: string = candidateProfile?.phone || "";
      let whatsappSent = false;
      if (candidatePhone && candidatePhone.length >= 10) {
        try {
          const ZAPI_INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID");
          const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN");
          if (ZAPI_INSTANCE_ID && ZAPI_TOKEN) {
            const waMessage = `Olá ${candidateName}! ✅ Sua documentação para a vaga de ${jobTitle} (${unitName}) foi aprovada. Verifique seu email para baixar os documentos. — Recruta RH`;
            const phoneClean = candidatePhone.replace(/\D/g, "");
            const phoneFormatted = phoneClean.startsWith("55") ? phoneClean : `55${phoneClean}`;
            const waResponse = await fetch(
              `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: phoneFormatted, message: waMessage }),
              }
            );
            whatsappSent = waResponse.ok;
          }
        } catch (waErr) {
          console.warn("WhatsApp notification failed:", waErr);
        }
      }

      // 9. Registrar auditoria em document_logs
      await admin.from("document_logs" as any).insert({
        candidate_id: candidateId || null,
        request_id: requestId,
        event: "documentacao_enviada",
        actor_id: userId,
        metadata: {
          actor_id: userId,
          candidate_email: candidateEmail,
          candidate_name: candidateName,
          job_title: jobTitle,
          unit_name: unitName,
          documents_sent: signedLinks.map((l) => l.name),
          documents_count: signedLinks.length,
          delivered,
          whatsapp_sent: whatsappSent,
          brevo_message_id: (brevoResult as any)?.messageId || null,
          sent_at: new Date().toISOString(),
        },
      } as any);

      if (!delivered) {
        console.error("Brevo delivery error:", brevoResult);
        return new Response(
          JSON.stringify({ success: false, error: "Email delivery failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          messageId: (brevoResult as any).messageId,
          documentsSent: signedLinks.length,
          recipientEmail: candidateEmail,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    },
    { allowedRoles: ["admin", "rh_franqueadora", "franqueado"] },
  ),
);
