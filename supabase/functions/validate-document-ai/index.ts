import { withAuth } from "../_shared/with-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { shouldLogAIDecision } from "../_shared/ai-log-guard.ts";

/**
 * Edge Function: validate-document-ai
 * Item 22 — AI-powered document validation
 * 
 * Accepts a document upload ID, fetches the file, sends it to OpenAI Vision
 * for validation (legibility, correct document type, data consistency),
 * and stores the result in document_logs.
 */

interface ValidateDocumentRequest {
  upload_id: string;
}

Deno.serve(withAuth(async (req, ctx) => {
  const startTime = Date.now();

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: corsHeaders,
      });
    }

    const { upload_id }: ValidateDocumentRequest = await req.json();
    if (!upload_id) {
      return new Response(JSON.stringify({ error: "upload_id required" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Check if AI document validation is enabled
    const { data: flagSetting } = await ctx.admin
      .from("global_settings")
      .select("value")
      .eq("category", "documents")
      .eq("key", "allow_document_ai_validation")
      .single();

    if (!flagSetting || flagSetting.value === false || flagSetting.value === "false") {
      return new Response(JSON.stringify({ error: "AI document validation is disabled" }), {
        status: 403, headers: corsHeaders,
      });
    }

    // Fetch the upload record
    const { data: upload, error: uploadErr } = await ctx.admin
      .from("document_uploads")
      .select("*, document_requests(candidate_id, job_id, unit_id, application_id)")
      .eq("id", upload_id)
      .single();

    if (uploadErr || !upload) {
      return new Response(JSON.stringify({ error: "Upload not found" }), {
        status: 404, headers: corsHeaders,
      });
    }

    const fileUrl = (upload as any).file_url;
    const documentType = (upload as any).document_type;

    // Download the file to get base64 for Vision API
    let imageBase64 = "";
    let mimeType = "image/jpeg";
    try {
      // If it's a Supabase storage URL, generate a signed URL
      if (fileUrl.includes("supabase") || fileUrl.startsWith("/")) {
        const bucketPath = fileUrl.replace(/^.*\/storage\/v1\/object\/public\//, "");
        const parts = bucketPath.split("/");
        const bucket = parts[0];
        const path = parts.slice(1).join("/");
        const { data: signedData } = await ctx.admin.storage.from(bucket).createSignedUrl(path, 300);
        if (signedData?.signedUrl) {
          const resp = await fetch(signedData.signedUrl);
          const buf = await resp.arrayBuffer();
          imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          const ct = resp.headers.get("content-type") || "image/jpeg";
          mimeType = ct;
        }
      } else {
        const resp = await fetch(fileUrl);
        const buf = await resp.arrayBuffer();
        imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const ct = resp.headers.get("content-type") || "image/jpeg";
        mimeType = ct;
      }
    } catch (e) {
      console.error("[validate-document-ai] File download error:", e);
      return new Response(JSON.stringify({ error: "Failed to download document file" }), {
        status: 500, headers: corsHeaders,
      });
    }

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Could not read document file" }), {
        status: 500, headers: corsHeaders,
      });
    }

    // Call OpenAI Vision API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Você é um validador de documentos para um sistema de recrutamento.
Analise a imagem do documento e responda em JSON com:
{
  "is_valid": true/false,
  "document_type_detected": "tipo detectado (ex: RG, CPF, comprovante_residencia, certidao_nascimento, etc)",
  "expected_type_match": true/false,
  "legibility_score": 0-100,
  "issues": ["lista de problemas encontrados"],
  "data_extracted": { "campos relevantes extraídos" },
  "confidence": 0-100,
  "recommendation": "approve" | "reject" | "manual_review"
}

Regras:
- Verifique se o documento é legível (sem cortes, borrões, reflexos)
- Verifique se o tipo do documento corresponde ao esperado
- Extraia dados visíveis (nome, número, data)
- Se houver qualquer dúvida, recomende "manual_review"
- Nunca aprove documentos ilegíveis ou cortados`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Tipo de documento esperado: ${documentType}\n\nValidar este documento:`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text();
      console.error("[validate-document-ai] OpenAI error:", errBody);
      throw new Error("AI validation service unavailable");
    }

    const aiResult = await openaiResponse.json();
    const rawContent = aiResult.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI returned empty response");
    const validation = JSON.parse(rawContent);

    const processingTime = Date.now() - startTime;

    // Log the validation result
    await ctx.admin.from("document_logs").insert({
      candidate_id: (upload as any).candidate_id,
      request_id: (upload as any).request_id,
      document_type: documentType,
      event: "ai_validation",
      actor_id: ctx.userId,
      metadata: {
        upload_id,
        validation_result: validation,
        processing_time_ms: processingTime,
        model: "gpt-4o-mini",
      },
    });

    // Log to ai_decision_logs
    const { data: candidateProfile } = await ctx.admin
      .from("profiles")
      .select("cpf")
      .eq("id", (upload as any).candidate_id)
      .single();

    if (candidateProfile?.cpf) {
      // Item 5: Check if AI decision logging is enabled
      const shouldLog = await shouldLogAIDecision(ctx.admin);
      if (shouldLog) {
        await ctx.admin.from("ai_decision_logs").insert({
          cpf: candidateProfile.cpf,
          module: "documentos",
          decision_type: validation.recommendation === "approve" ? "aprovacao" : validation.recommendation === "reject" ? "rejeicao" : "analise",
          input: { upload_id, document_type: documentType, file_url: fileUrl },
          output: validation,
          model_provider: "openai",
          model_version: "gpt-4o-mini",
          actor_id: ctx.userId,
          application_id: (upload as any).document_requests?.application_id || null,
          processing_time_ms: processingTime,
        });
      }
    }

    // Auto-update upload status based on recommendation
    if (validation.recommendation === "approve" && validation.confidence >= 80) {
      await ctx.admin.from("document_uploads")
        .update({ status: "approved", validated_at: new Date().toISOString(), validated_by: ctx.userId })
        .eq("id", upload_id);
    } else if (validation.recommendation === "reject" && validation.confidence >= 90) {
      await ctx.admin.from("document_uploads")
        .update({ status: "rejected", rejection_reason: (validation.issues || []).join("; ") })
        .eq("id", upload_id);
    }
    // For manual_review or low confidence, leave as-is for human review

    return new Response(JSON.stringify({
      upload_id,
      validation,
      processing_time_ms: processingTime,
      auto_action: validation.recommendation === "approve" && validation.confidence >= 80
        ? "auto_approved"
        : validation.recommendation === "reject" && validation.confidence >= 90
          ? "auto_rejected"
          : "pending_human_review",
    }), {
      status: 200, headers: corsHeaders,
    });
  } catch (err) {
    console.error("[validate-document-ai] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Internal error" }), {
      status: 500, headers: corsHeaders,
    });
  }
}, { allowedRoles: ["admin", "franqueado"] }));
