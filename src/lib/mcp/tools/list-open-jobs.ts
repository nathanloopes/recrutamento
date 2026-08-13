import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "list_open_jobs",
  title: "Listar vagas abertas",
  description:
    "Retorna as vagas atualmente abertas (unit_jobs com status ativo), incluindo cargo, unidade, cidade/UF, salário, modelo de trabalho e número de posições.",
  inputSchema: {
    city: z
      .string()
      .optional()
      .describe("Filtrar por cidade (opcional, case-insensitive)."),
    state: z
      .string()
      .optional()
      .describe("Filtrar por UF (opcional, ex.: SP)."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Máximo de vagas a retornar (padrão 50)."),
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async ({ city, state, limit }) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      return {
        content: [{ type: "text", text: "Supabase não configurado neste ambiente." }],
        isError: true,
      };
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const max = Math.min(limit ?? 50, 200);
    let query = supabase
      .from("unit_jobs")
      .select(
        "id, salary, openings, work_model, contract_type, address_city, address_state, jobs(title), units(name, code)"
      )
      .eq("status", "aberta")
      .limit(max);

    if (city) query = query.ilike("address_city", `%${city}%`);
    if (state) query = query.ilike("address_state", state);

    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }

    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      cargo: r.jobs?.title ?? null,
      unidade: r.units?.name ?? null,
      codigo_unidade: r.units?.code ?? null,
      cidade: r.address_city,
      uf: r.address_state,
      salario: r.salary,
      posicoes: r.openings,
      modelo: r.work_model,
      contrato: r.contract_type,
    }));

    return {
      content: [
        {
          type: "text",
          text: rows.length
            ? `${rows.length} vaga(s) aberta(s):\n${JSON.stringify(rows, null, 2)}`
            : "Nenhuma vaga aberta encontrada com esses filtros.",
        },
      ],
      structuredContent: { jobs: rows, count: rows.length },
    };
  },
});
