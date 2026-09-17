import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { money, num } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { CreditCard, Receipt } from 'lucide-react';

const INVOICE_STATUS = {
  paid: ['Paga', 'badge-success'],
  open: ['Em aberto', 'badge-warning'],
  overdue: ['Vencida', 'badge-error'],
  void: ['Cancelada', ''],
};

const date = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—');

export default function BillingPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get('/settings/billing').then(r => setData(r.data)).catch(() => setError(true));
  }, []);

  if (error) return <p className="text-xs text-destructive mt-4">Não foi possível carregar o faturamento.</p>;
  if (!data) return <p className="text-xs text-muted-foreground mt-4">Carregando…</p>;

  const { plan, plan_label: planLabel, usage, invoices, currency } = data;

  return (
    <div className="space-y-4" data-testid="billing-panel">
      <div className="stat-card max-w-2xl">
        <div className="flex items-center gap-2 mb-2"><CreditCard size={14} /><span className="text-sm font-medium">Plano</span></div>
        {plan ? (
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-lg font-semibold">{plan.name}</span>
            <span className="text-xs text-muted-foreground">{money(plan.price, plan.currency || currency)} / mês · versão {plan.version ?? 1}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {planLabel
              ? `Plano "${planLabel}" atribuído, mas não cadastrado em Plataforma > Planos — limites indisponíveis.`
              : 'Nenhum plano atribuído a este workspace.'}
          </p>
        )}
      </div>

      <div className="stat-card max-w-2xl">
        <div className="text-sm font-medium mb-3">Consumo desde {date(data.period_start)}</div>
        <div className="space-y-3">
          {usage.map(u => {
            const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : null;
            return (
              <div key={u.key} data-testid={`usage-${u.key}`}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{u.label}</span>
                  <span className={pct !== null && pct >= 90 ? 'text-destructive' : 'text-muted-foreground'}>
                    {num(u.used)} {u.limit ? `/ ${num(u.limit)}` : '· sem limite'}
                  </span>
                </div>
                {pct !== null && <Progress value={pct} className="h-1.5" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="flex items-center gap-2 mb-2"><Receipt size={14} /><span className="text-sm font-medium">Faturas</span></div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Número</TableHead>
            <TableHead className="text-xs">Emissão</TableHead>
            <TableHead className="text-xs">Vencimento</TableHead>
            <TableHead className="text-xs text-right">Valor</TableHead>
            <TableHead className="text-xs">Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-8">Nenhuma fatura emitida.</TableCell></TableRow>
            ) : invoices.map(inv => {
              const [label, cls] = INVOICE_STATUS[inv.status] || [inv.status, ''];
              return (
                <TableRow key={inv._id}>
                  <TableCell className="text-xs font-mono">{inv.number || inv._id.slice(-8)}</TableCell>
                  <TableCell className="text-xs">{date(inv.issued_at)}</TableCell>
                  <TableCell className="text-xs">{date(inv.due_at)}</TableCell>
                  <TableCell className="text-xs text-right">{money(inv.amount, inv.currency || currency)}</TableCell>
                  <TableCell><Badge className={`text-[9px] ${cls}`}>{label}</Badge></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
