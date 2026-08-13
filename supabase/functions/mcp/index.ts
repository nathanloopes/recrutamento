// Supabase Edge Function: mcp
// Entry gerado a partir de src/lib/mcp/index.ts.
import mcp from "../../../src/lib/mcp/index.ts";
import { createSupabaseHandler } from "npm:@lovable.dev/mcp-js@0.20.0/stacks/supabase";
Deno.serve(createSupabaseHandler(mcp, { functionName: "mcp" }));
