import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight } from "lucide-react";

interface ConditionRow {
  field: string;
  operator: string;
  value: string;
}

const FIELD_OPTIONS = [
  { value: "phase", label: "Fase" },
  { value: "status", label: "Status" },
  { value: "score", label: "Score" },
  { value: "unit_id", label: "Unidade" },
  { value: "job_id", label: "Cargo" },
  { value: "candidate_id", label: "Candidato" },
  { value: "modality", label: "Modalidade" },
];

const OPERATOR_OPTIONS = [
  { value: "equals", label: "=" },
  { value: "not_equals", label: "≠" },
  { value: "greater_than", label: ">" },
  { value: "less_than", label: "<" },
  { value: "contains", label: "contém" },
];

interface Props {
  value: string; // JSON string
  onChange: (json: string) => void;
}

export function AutomationRuleBuilder({ value, onChange }: Props) {
  const [conditions, setConditions] = useState<ConditionRow[]>(() => {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([field, val]) => ({
          field,
          operator: "equals",
          value: String(val),
        }));
      }
    } catch {}
    return [];
  });

  const addCondition = () => {
    const updated = [...conditions, { field: "", operator: "equals", value: "" }];
    setConditions(updated);
    syncToJson(updated);
  };

  const removeCondition = (idx: number) => {
    const updated = conditions.filter((_, i) => i !== idx);
    setConditions(updated);
    syncToJson(updated);
  };

  const updateCondition = (idx: number, key: keyof ConditionRow, val: string) => {
    const updated = conditions.map((c, i) => (i === idx ? { ...c, [key]: val } : c));
    setConditions(updated);
    syncToJson(updated);
  };

  const syncToJson = (rows: ConditionRow[]) => {
    const obj: Record<string, any> = {};
    for (const row of rows) {
      if (!row.field) continue;
      if (row.operator === "equals") {
        obj[row.field] = isNaN(Number(row.value)) ? row.value : Number(row.value);
      } else {
        obj[row.field] = { [`$${row.operator}`]: isNaN(Number(row.value)) ? row.value : Number(row.value) };
      }
    }
    onChange(JSON.stringify(obj, null, 2));
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2 px-3 pt-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Condições</span>
          <Button variant="ghost" size="sm" onClick={addCondition}>
            <Plus className="h-3 w-3 mr-1" /> Adicionar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {conditions.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Sem condições — regra será executada sempre que o evento ocorrer.
          </p>
        )}
        {conditions.map((c, idx) => (
          <div key={idx} className="flex items-center gap-2 flex-wrap">
            <Select value={c.field} onValueChange={(v) => updateCondition(idx, "field", v)}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue placeholder="Campo" />
              </SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={c.operator} onValueChange={(v) => updateCondition(idx, "operator", v)}>
              <SelectTrigger className="w-20 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATOR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={c.value}
              onChange={(e) => updateCondition(idx, "value", e.target.value)}
              className="flex-1 h-8 text-xs min-w-[80px]"
              placeholder="Valor"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeCondition(idx)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        ))}
        {conditions.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Badge variant="outline" className="text-[10px]">Lógica: AND</Badge>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Todas as condições devem ser verdadeiras</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
