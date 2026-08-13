// Helper compartilhado para entregabilidade (anti-spam) dos envios via Brevo.
// - Gera rodapé institucional (CAN-SPAM/LGPD friendly)
// - Converte HTML em texto puro (multipart text/plain real)
// - Monta headers padrão (List-Unsubscribe One-Click, Reply-To etc.)

export const COMPANY_NAME = "Recruta";
export const COMPANY_LEGAL = "Recruta Franchising Ltda.";
export const COMPANY_ADDRESS = "Rua das Acácias, 123 — Centro, Curitiba/PR — CEP 80000-000";
export const SENDER_EMAIL = "rh@example.com";
export const SENDER_NAME = "Recruta - Recrutamento";
export const REPLY_TO_EMAIL = "rh@example.com";
export const UNSUBSCRIBE_MAILTO = "descadastro@example.com";
export const UNSUBSCRIBE_URL_BASE = "https://recrutamento.example.com/descadastro";

export function buildUnsubscribeUrl(toEmail: string): string {
  return `${UNSUBSCRIBE_URL_BASE}?email=${encodeURIComponent(toEmail)}`;
}

/** Headers anti-spam padronizados (Gmail/Yahoo 2024 compliance). */
export function buildDeliverabilityHeaders(toEmail: string, refId?: string): Record<string, string> {
  const unsubUrl = buildUnsubscribeUrl(toEmail);
  return {
    "List-Unsubscribe": `<mailto:${UNSUBSCRIBE_MAILTO}?subject=unsubscribe>, <${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "X-Entity-Ref-ID": refId || crypto.randomUUID(),
    "X-Mailer": "Recruta-Recrutamento/1.0",
  };
}

/** Rodapé institucional HTML (mantém compliance, melhora reputação e proporção texto/imagem). */
export function institutionalFooterHtml(toEmail: string): string {
  const unsubUrl = buildUnsubscribeUrl(toEmail);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;border-top:1px solid #E5E7EB;padding-top:20px;font-family:Arial,sans-serif;">
      <tr><td style="font-size:12px;color:#4B5563;line-height:1.6;padding:0 12px 12px;">
        <p style="margin:0 0 10px;">
          Olá! Este e-mail faz parte do processo seletivo da <strong>${COMPANY_NAME}</strong>.
          Estamos felizes em ter você conosco nesta jornada e seguiremos enviando atualizações
          sobre cada etapa da sua candidatura por aqui.
        </p>
        <p style="margin:0 0 10px;">
          Se tiver qualquer dúvida sobre vagas, testes, entrevistas ou documentos, você pode
          responder diretamente a este e-mail ou entrar em contato com nossa equipe de Recursos
          Humanos pelo endereço <a href="mailto:${REPLY_TO_EMAIL}" style="color:#B45309;text-decoration:underline;">${REPLY_TO_EMAIL}</a>.
          Nosso compromisso é dar retorno em até 48 horas úteis.
        </p>
        <p style="margin:0 0 10px;">
          Importante: nunca solicitamos pagamentos, taxas ou depósitos em nenhuma fase do
          processo seletivo. Caso receba uma comunicação suspeita em nome da ${COMPANY_NAME},
          ignore e nos avise imediatamente.
        </p>
      </td></tr>
      <tr><td style="font-size:11px;color:#6B7280;line-height:1.5;text-align:center;border-top:1px solid #F3F4F6;padding-top:12px;">
        <strong>${COMPANY_LEGAL}</strong><br/>
        ${COMPANY_ADDRESS}<br/>
        Você está recebendo este e-mail porque participa de um processo seletivo da ${COMPANY_NAME}.<br/>
        <a href="${unsubUrl}" style="color:#6B7280;text-decoration:underline;">Descadastrar</a>
        &nbsp;•&nbsp;
        <a href="mailto:${REPLY_TO_EMAIL}" style="color:#6B7280;text-decoration:underline;">Falar com o RH</a>
      </td></tr>
    </table>
  `.trim();
}

export function institutionalFooterText(toEmail: string): string {
  const unsubUrl = buildUnsubscribeUrl(toEmail);
  return [
    "",
    "—",
    `Este e-mail faz parte do processo seletivo da ${COMPANY_NAME}.`,
    "Seguiremos enviando atualizações sobre cada etapa da sua candidatura por aqui.",
    "",
    "Dúvidas sobre vagas, testes, entrevistas ou documentos: responda a este e-mail",
    `ou escreva para ${REPLY_TO_EMAIL}. Damos retorno em até 48 horas úteis.`,
    "",
    "Importante: nunca solicitamos pagamentos, taxas ou depósitos em nenhuma fase",
    "do processo seletivo. Em caso de comunicação suspeita, nos avise imediatamente.",
    "",
    `${COMPANY_LEGAL}`,
    `${COMPANY_ADDRESS}`,
    `Falar com o RH: ${REPLY_TO_EMAIL}`,
    `Descadastrar: ${unsubUrl}`,
  ].join("\n");
}

/** Strip de HTML → texto puro (para garantir text/plain real e melhorar score). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Garante que o HTML tenha o rodapé institucional anexado (idempotente). */
export function ensureFooterHtml(html: string, toEmail: string): string {
  if (html.includes("List-Unsubscribe-Footer-Marker")) return html;
  const footer = `<div data-marker="List-Unsubscribe-Footer-Marker">${institutionalFooterHtml(toEmail)}</div>`;
  // Insere antes do </body> quando existir; senão concatena.
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${footer}</body>`);
  }
  return `${html}\n${footer}`;
}
