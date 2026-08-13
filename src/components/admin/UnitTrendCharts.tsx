import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUnitTrends } from "@/hooks/useUnitTrends";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

export function UnitTrendCharts() {
  const { data: trends, isLoading } = useUnitTrends();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-[300px]" />
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  if (!trends?.length) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolução de Candidaturas (6 meses)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="total" name="Total" stroke="hsl(var(--primary))" strokeWidth={2} />
              <Line type="monotone" dataKey="hired" name="Contratados" stroke="hsl(142 76% 36%)" strokeWidth={2} />
              <Line type="monotone" dataKey="rejected" name="Standby" stroke="hsl(45 93% 47%)" strokeWidth={2} />
              <Line type="monotone" dataKey="withdrawn" name="Desistentes" stroke="hsl(38 92% 50%)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxas % (6 meses)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis unit="%" className="text-xs" />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Legend />
              <Line type="monotone" dataKey="conversionRate" name="Conversão" stroke="hsl(142 76% 36%)" strokeWidth={2} />
              <Line type="monotone" dataKey="rejectionRate" name="Standby" stroke="hsl(45 93% 47%)" strokeWidth={2} />
              <Line type="monotone" dataKey="withdrawalRate" name="Desistência" stroke="hsl(38 92% 50%)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
