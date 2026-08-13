import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ManualUnitDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [isActive, setIsActive] = useState(true);

  const reset = () => {
    setName(""); setCode(""); setCity(""); setState(""); setCompanyId(""); setIsActive(true);
  };

  const submit = async () => {
    if (!name.trim() || !code.trim()) {
      toast.error("Nome e Código são obrigatórios.");
      return;
    }
    if (state && state.length !== 2) {
      toast.error("UF deve ter 2 letras.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-manual-unit", {
        body: {
          name: name.trim(),
          code: code.trim(),
          city: city.trim() || null,
          state: state.trim() || null,
          company_id: companyId.trim() || null,
          is_active: isActive,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);

      toast.success("Unidade cadastrada com sucesso.");
      qc.invalidateQueries({ queryKey: ["units"] });
      qc.invalidateQueries({ queryKey: ["unit_monitoring"] });
      qc.invalidateQueries({ queryKey: ["unit_jobs_global_listing"] });
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao cadastrar unidade.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Nova Unidade Manual</DialogTitle>
          <DialogDescription>
            Cadastro restrito a Administradores. Unidade será marcada como <strong>MANUAL</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Nome da Unidade *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Recruta - Centro" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Código *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex: CP001" />
            </div>
            <div className="space-y-1">
              <Label>Empresa (UUID, opcional)</Label>
              <Input value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="opcional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cidade</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>UF</Label>
              <Input maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="SP" />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Unidade ativa</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
