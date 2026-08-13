/**
 * send-documents-external
 *
 * Envia os documentos APROVADOS de um candidato para um email externo
 * digitado manualmente pelo responsável (ex: contabilidade, jurídico).
 *
 * - Rota: POST /functions/v1/send-documents-external
 * - Roles: admin | rh_franqueadora | franqueado
 * - Body: { requestId: string, destinationEmails: string[] }
 *   (aceita também destinationEmail: string por compatibilidade)
 *
 * Estratégia de envio:
 *   - Tenta baixar os arquivos e enviar como anexos base64 (até MAX_ATTACHMENT_BYTES)
 *   - Se total exceder o limite, envia links assinados (7 dias) em vez de anexos
 *
 * Provedor: Brevo SMTP API (variável BREVO_API_KEY já presente no projeto)
 *
 * ENV opcional para SMTP nativo (futuro):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   (compatível com Gmail, Outlook, servidor próprio)
 */

import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

/** 10 MB — limite seguro antes de trocar para links */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

Deno.serve(
  withAuth(
    async (req, ctx) => {
      const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
      if (!BREVO_API_KEY) {
        return new Response(
          JSON.stringify({ error: "Email service not configured (BREVO_API_KEY missing)" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ── Parse + validação básica ──────────────────────────────────────────
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { requestId, destinationEmails, destinationEmail } = body as {
        requestId?: string;
        destinationEmails?: string[];
        destinationEmail?: string; // compatibilidade retroativa
      };

      if (!requestId || typeof requestId !== "string") {
        return new Response(
          JSON.stringify({ error: "requestId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Aceita array (novo) ou string única (retrocompatível)
      const rawEmails: string[] = Array.isArray(destinationEmails)
        ? destinationEmails
        : destinationEmail
        ? [destinationEmail]
        : [];

      if (rawEmails.length === 0) {
        return new Response(
          JSON.stringify({ error: "At least one destination email is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (rawEmails.length > 10) {
        return new Response(
          JSON.stringify({ error: "Maximum of 10 destination emails allowed" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const sanitizedEmails: string[] = [];
      const invalidEmails: string[] = [];

      for (const raw of rawEmails) {
        const s = raw.trim().toLowerCase().slice(0, 320);
        if (!emailRegex.test(s)) {
          invalidEmails.push(raw);
        } else {
          sanitizedEmails.push(s);
        }
      }

      if (invalidEmails.length > 0) {
        return new Response(
          JSON.stringify({ error: "Invalid email format", invalid: invalidEmails }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Remove duplicatas
      const uniqueEmails = [...new Set(sanitizedEmails)];

      const { admin, userId } = ctx;

      // ── Buscar solicitação de documentos ─────────────────────────────────
      const { data: request, error: reqError } = await admin
        .from("document_requests")
        .select(
          "*, profiles:candidate_id(id, full_name, email, cpf), jobs:job_id(title), units:unit_id(name)",
        )
        .eq("id", requestId)
        .single();

      if (reqError || !request) {
        return new Response(
          JSON.stringify({ error: "Document request not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const candidateProfile = (request as any).profiles;
      const candidateName: string = candidateProfile?.full_name || "Candidato";
      const candidateId: string = candidateProfile?.id || "";
      const candidateCpf: string = candidateProfile?.cpf || "";
      const jobTitle: string = (request as any).jobs?.title || "Vaga";
      const unitName: string = (request as any).units?.name || "Unidade";

      // ── Buscar uploads aprovados (dedup: 1 por tipo, mais recente) ────────
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

      const latestByType: Record<string, any> = {};
      for (const u of uploads || []) {
        const docType = (u as any).document_type as string;
        if (!latestByType[docType]) latestByType[docType] = u;
      }
      const approvedUploads = Object.values(latestByType);

      if (approvedUploads.length === 0) {
        return new Response(
          JSON.stringify({ error: "No approved documents found for this request" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ── Verificar que TODOS os documentos obrigatórios estão aprovados ────
      const allRequired: string[] = [
        ...((request.documents_list as string[]) || []),
        ...((request.custom_documents as string[]) || []),
      ];
      const approvedTypes = new Set(approvedUploads.map((u: any) => u.document_type as string));
      const missingDocs = allRequired.filter((d) => !approvedTypes.has(d));

      if (missingDocs.length > 0) {
        return new Response(
          JSON.stringify({
            error: "Not all required documents are approved",
            missing: missingDocs,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ── Tentar baixar e construir anexos base64 ───────────────────────────
      const attachments: Array<{ name: string; content: string }> = [];
      const signedLinks: Array<{ name: string; url: string }> = [];
      let totalBytes = 0;
      let useAttachments = true;

      for (const u of approvedUploads) {
        const filePath = (u as any).file_url as string;
        const docType = (u as any).document_type as string;
        const ext = filePath.split(".").pop()?.toLowerCase() || "bin";

        // Nome seguro para anexo
        const safeName = docType
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9\s]/g, "_")
          .trim()
          .replace(/\s+/g, "_")
          .slice(0, 80);
        const fileName = `${safeName}.${ext}`;

        // Link assinado sempre gerado (fallback ou inclusão no email)
        const { data: signed } = await admin.storage
          .from("documents")
          .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 dias
        if (signed?.signedUrl) {
          signedLinks.push({ name: docType, url: signed.signedUrl });
        }

        // Tentar baixar se ainda dentro do limite
        if (useAttachments) {
          try {
            const { data: fileBlob, error: dlError } = await admin.storage
              .from("documents")
              .download(filePath);

            if (dlError || !fileBlob) {
              console.warn(`[send-documents-external] Download failed for ${docType}:`, dlError);
              useAttachments = false;
              continue;
            }

            const arrayBuffer = await fileBlob.arrayBuffer();
            totalBytes += arrayBuffer.byteLength;

            if (totalBytes > MAX_ATTACHMENT_BYTES) {
              console.info(
                `[send-documents-external] Size limit exceeded (${totalBytes} bytes). Switching to signed URLs.`,
              );
              useAttachments = false;
              // Limpar anexos já preparados — vai usar links
              attachments.length = 0;
              break;
            }

            // Converter para base64 sem Buffer (Deno puro)
            const uint8 = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8.length; i++) {
              binary += String.fromCharCode(uint8[i]);
            }
            attachments.push({ name: fileName, content: btoa(binary) });
          } catch (err) {
            console.warn(`[send-documents-external] Error processing ${docType}:`, err);
            useAttachments = false;
            attachments.length = 0;
          }
        }
      }

      // ── Montar corpo HTML ─────────────────────────────────────────────────
      const sentAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

      const docsRows = approvedUploads
        .map((u: any, i: number) => {
          const docType = (u as any).document_type as string;
          const link = signedLinks.find((l) => l.name === docType);
          const bg = i % 2 === 0 ? "#f9fafb" : "#ffffff";
          const fileCell = useAttachments
            ? `<span style="color:#16a34a;font-weight:600;">✅ Em anexo</span>`
            : link
            ? `<a href="${link.url}" style="color:#1a56db;font-size:13px;">Baixar (link válido 7 dias)</a>`
            : `<span style="color:#aaa;">—</span>`;
          return `<tr style="background:${bg};">
            <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;">${docType}</td>
            <td style="padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">
              ${fileCell}
            </td>
          </tr>`;
        })
        .join("");

      const deliveryNote = useAttachments
        ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:12px 16px;margin-top:16px;">
            <p style="margin:0;color:#166534;font-size:13px;">📎 <strong>${attachments.length} arquivo(s)</strong> enviado(s) como anexo neste email.</p>
          </div>`
        : `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:12px 16px;margin-top:16px;">
            <p style="margin:0;color:#92400e;font-size:13px;">🔗 Documentos disponíveis via links seguros (válidos por 7 dias). Clique nos links da tabela acima.</p>
          </div>`;

      const htmlContent = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#1f2937;">
          <div style="background:#1e3a5f;padding:24px 28px;border-radius:8px 8px 0 0;">
            <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">
              📄 Documentação para Contratação
            </h1>
            <p style="color:#93c5fd;margin:6px 0 0 0;font-size:13px;">
              Grupo Recruta — Recursos Humanos
            </p>
          </div>

          <div style="padding:28px 28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">

            <h2 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 14px 0;
                       text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">
              Dados do Candidato
            </h2>

            <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;">
              <tr>
                <td style="padding:6px 0;color:#6b7280;width:150px;">Nome completo:</td>
                <td style="padding:6px 0;font-weight:600;">${candidateName}</td>
              </tr>
              ${
                candidateCpf
                  ? `<tr>
                      <td style="padding:6px 0;color:#6b7280;">CPF:</td>
                      <td style="padding:6px 0;">${candidateCpf}</td>
                    </tr>`
                  : ""
              }
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Cargo:</td>
                <td style="padding:6px 0;">${jobTitle}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Unidade:</td>
                <td style="padding:6px 0;">${unitName}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Data de envio:</td>
                <td style="padding:6px 0;">${sentAt}</td>
              </tr>
            </table>

            <h2 style="font-size:14px;font-weight:700;color:#1e3a5f;margin:0 0 14px 0;
                       text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">
              Documentos Aprovados (${approvedUploads.length})
            </h2>

            <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;font-size:13px;">
              <thead>
                <tr style="background:#f0f4ff;">
                  <th style="padding:10px 14px;text-align:left;color:#374151;font-weight:600;">Documento</th>
                  <th style="padding:10px 14px;text-align:center;color:#374151;font-weight:600;">Arquivo</th>
                </tr>
              </thead>
              <tbody>${docsRows}</tbody>
            </table>

            ${deliveryNote}

            <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                Esta mensagem foi gerada automaticamente pelo Sistema de RH do Grupo Recruta em
                ${sentAt}. Não responda a este email.
              </p>
            </div>
          </div>
        </div>
      `;

      const textContent =
        `Documentação para contratação — ${candidateName} (${candidateCpf || "CPF não informado"})\n` +
        `Cargo: ${jobTitle} | Unidade: ${unitName}\n` +
        `Data: ${sentAt}\n\n` +
        `Documentos (${approvedUploads.length}): ${approvedUploads.map((u: any) => (u as any).document_type as string).join(", ")}\n\n` +
        (useAttachments
          ? `Os documentos estão anexados a este email.`
          : `Links de download:\n${signedLinks.map((l) => `- ${l.name}: ${l.url}`).join("\n")}`);

      // ── Payload Brevo ─────────────────────────────────────────────────────
      const brevoPayload: Record<string, unknown> = {
        sender: { name: "Recruta - RH", email: "rh@example.com" },
        to: uniqueEmails.map((e) => ({ email: e })),
        subject: `Documentação — ${candidateName} — ${jobTitle} — ${unitName}`,
        htmlContent,
        textContent,
      };

      if (useAttachments && attachments.length > 0) {
        brevoPayload.attachment = attachments.map((a) => ({
          name: a.name,
          content: a.content,
        }));
      }

      // ── Envio com retry (até 2 tentativas) ────────────────────────────────
      let brevoResult: Record<string, unknown> = {};
      let delivered = false;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 25_000); // 25s timeout

          const res = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
              "api-key": BREVO_API_KEY,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(brevoPayload),
            signal: controller.signal,
          });

          clearTimeout(timer);
          brevoResult = (await res.json()) as Record<string, unknown>;
          delivered = res.ok;

          if (delivered) break;
          console.warn(`[send-documents-external] Attempt ${attempt} failed:`, brevoResult);
        } catch (err) {
          console.error(`[send-documents-external] Attempt ${attempt} exception:`, err);
          if (attempt === 2) {
            // Registrar falha na auditoria antes de retornar erro
            await admin.from("document_logs" as any).insert({
              candidate_id: candidateId || null,
              request_id: requestId,
              event: "documentos_enviados_externo",
              actor_id: userId,
              metadata: {
                actor_id: userId,
                destination_emails: uniqueEmails,
                candidate_name: candidateName,
                candidate_id: candidateId,
                job_title: jobTitle,
                unit_name: unitName,
                documents_sent: approvedUploads.map((u: any) => (u as any).document_type),
                documents_count: approvedUploads.length,
                delivery_mode: useAttachments ? "attachment" : "signed_url",
                total_size_bytes: totalBytes,
                delivered: false,
                error: String(err),
                sent_at: new Date().toISOString(),
              },
            } as any);
            return new Response(
              JSON.stringify({ success: false, error: "Email delivery failed after retries" }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          // Aguardar 1s antes de retry
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // ── Registrar auditoria ───────────────────────────────────────────────
      await admin.from("document_logs" as any).insert({
        candidate_id: candidateId || null,
        request_id: requestId,
        event: "documentos_enviados_externo",
        actor_id: userId,
        metadata: {
          actor_id: userId,
          destination_emails: uniqueEmails,
          candidate_name: candidateName,
          candidate_id: candidateId,
          job_title: jobTitle,
          unit_name: unitName,
          documents_sent: approvedUploads.map((u: any) => (u as any).document_type),
          documents_count: approvedUploads.length,
          delivery_mode: useAttachments ? "attachment" : "signed_url",
          total_size_bytes: totalBytes,
          delivered,
          brevo_message_id: (brevoResult?.messageId as string) || null,
          sent_at: new Date().toISOString(),
        },
      } as any);

      if (!delivered) {
        console.error("[send-documents-external] Brevo delivery error:", brevoResult);
        return new Response(
          JSON.stringify({ success: false, error: "Email delivery failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          messageId: brevoResult.messageId,
          documentsSent: approvedUploads.length,
          deliveryMode: useAttachments ? "attachment" : "signed_url",
          destinationEmails: uniqueEmails,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    },
    { allowedRoles: ["admin", "rh_franqueadora", "franqueado"] },
  ),
);
