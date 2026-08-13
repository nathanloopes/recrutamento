import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, ChevronRight, Clock, CheckCircle2, AlertCircle, Hourglass, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PageHelp } from "@/components/ui/page-help";
import { useMyDocumentRequests } from "@/hooks/useDocuments";
import { useDocumentRealtime } from "@/hooks/useDocumentRealtime";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatDateBR } from "@/lib/dateUtils";


const computedStatusConfig = {
  pending_upload: { label: "Pendente envio", className: "bg-gray-100 text-gray-700 border-gray-300" },
  awaiting_approval: { label: "Aguardando aprovação", className: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  approved: { label: "Aprovado", className: "bg-green-100 text-green-800 border-green-300" },
  rejected: { label: "Revisão necessária", className: "bg-orange-100 text-orange-700 border-orange-300" },
  expired: { label: "Prazo vencido", className: "bg-red-100 text-red-700 border-red-300" },
} as const;

function getComputedStatus(req: any, totalDocs: number): keyof typeof computedStatusConfig {
  if (req.status === "completed") return "approved";
  const uploaded = req.uploaded_count || 0;
  const pending = req.pending_count || 0;
  const rejected = req.rejected_count || 0;
  if (uploaded < totalDocs) return "pending_upload";
  if (pending > 0) return "awaiting_approval";
  if (uploaded === totalDocs && rejected === 0) return "approved";
  if (rejected > 0) return "rejected";
  return "pending_upload";
}

export default function DocumentsHub() {
  useDocumentRealtime();
  const navigate = useNavigate();
  const { data: requests, isLoading } = useMyDocumentRequests();


  return (
    <div className="px-4 pt-6 pb-24 space-y-6 max-w-full">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">Meus Documentos</h1>
          <p className="text-sm text-muted-foreground">Checklists de documentos das suas candidaturas</p>
        </div>
        <PageHelp />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-muted rounded w-1/3 mb-3" />
                <div className="h-3 bg-muted rounded w-1/2 mb-2" />
                <div className="h-2 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !requests?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="font-semibold text-lg mb-1">Nenhuma ação necessária</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Quando você for aprovado em uma vaga, o checklist de documentos será liberado aqui automaticamente. Continue acompanhando suas candidaturas!
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => {
            const docsList = Array.isArray(req.documents_list) ? req.documents_list : [];
            const customDocs = Array.isArray(req.custom_documents) ? req.custom_documents : [];
            const totalDocs = docsList.length + customDocs.length;
            const requiredTotal = req.required_total ?? totalDocs;
            const requiredUploaded = Math.min(req.required_uploaded ?? 0, requiredTotal);
            const uploadedCount = req.uploaded_count || 0;
            const pendingCount = req.pending_count || 0;
            const approvedCount = req.approved_count || 0;
            const rejectedCount = req.rejected_count || 0;
            const progress = requiredTotal > 0 ? Math.round((requiredUploaded / requiredTotal) * 100) : 0;
            const isExpired = req.deadline_date && new Date(req.deadline_date) < new Date() && req.status !== "completed";
            const statusKey = isExpired ? "expired" : getComputedStatus(req, totalDocs);
            const statusConf = computedStatusConfig[statusKey];

            // Build detail line
            const details: string[] = [];
            details.push(`${requiredUploaded}/${requiredTotal} obrigatórios`);
            if (pendingCount > 0) details.push(`${pendingCount} em análise`);
            if (approvedCount > 0) details.push(`${approvedCount} aprovado${approvedCount > 1 ? "s" : ""}`);
            if (rejectedCount > 0) details.push(`${rejectedCount} para revisão`);

            return (
              <Card key={req.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <CardTitle className="text-base">
                        {req.job_title || "Vaga"}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {req.unit_name || "Unidade"}
                      </p>
                    </div>
                    <Badge variant="outline" className={`${statusConf.className} shrink-0`}>
                      {statusConf.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {req.deadline_date && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        Prazo: {formatDateBR(req.deadline_date)}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {details.join(" • ")}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground text-right">{progress}%</p>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate(`/documentos/${req.application_id}`)}
                  >
                    Ver documentos
                    <ChevronRight className="h-4 w-4 ml-auto" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
