import { defineMcp } from "@lovable.dev/mcp-js";
import listOpenJobs from "./tools/list-open-jobs";

export default defineMcp({
  name: "recruta-recrutamento-mcp",
  title: "Recruta Recrutamento MCP",
  version: "0.1.0",
  instructions:
    "Ferramentas do sistema de recrutamento Recruta. Use `list_open_jobs` para consultar as vagas atualmente abertas por cidade/UF.",
  tools: [listOpenJobs],
});
