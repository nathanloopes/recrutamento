import { AutoConfirmUnitsList } from "@/components/admin/settings/AutoConfirmUnitsList";
import { ScheduleGroupsPanel } from "@/components/admin/settings/ScheduleGroupsPanel";
import { SlotsManagerCard } from "@/components/admin/settings/SlotsManagerCard";
import { TestSchedulingCard } from "@/components/admin/settings/TestSchedulingCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

export function SchedulingConfigSection() {
  const { hasRole } = useAuth();
  // "Auto-confirmação por unidade" é ferramenta administrativa da franqueadora
  // (gerencia auto-confirmação em massa de todas as unidades). Não deve
  // aparecer para franqueado/gestor da unidade.
  const canManageAutoConfirm = hasRole("admin") || hasRole("rh_franqueadora");

  return (
    <div className="space-y-6">
      <SlotsManagerCard />

      {/* Bate-papo pós-teste removido do fluxo — o novo fluxo é Online + Presencial.
          A configuração de horários de bate-papo (ChatSlotsManagerCard) foi ocultada;
          os dados/tabelas permanecem para compatibilidade. */}

      <Card>
        <CardHeader>
          <CardTitle>Configuração de Agenda</CardTitle>
          <CardDescription>Grupos de agenda compartilhada entre unidades.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScheduleGroupsPanel />
        </CardContent>
      </Card>

      {canManageAutoConfirm && (
        <Card>
          <CardHeader>
            <CardTitle>Auto-confirmação por unidade</CardTitle>
            <CardDescription>Unidades que confirmam agendamentos automaticamente.</CardDescription>
          </CardHeader>
          <CardContent>
            <AutoConfirmUnitsList />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Testes Técnicos</CardTitle>
          <CardDescription>Configuração do teste técnico aplicado após a entrevista.</CardDescription>
        </CardHeader>
        <CardContent>
          <TestSchedulingCard />
        </CardContent>
      </Card>
    </div>
  );
}
