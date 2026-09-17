import { useState, useEffect, useCallback } from 'react';
import api, { formatApiError } from '@/lib/api';
import { money, num } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const PERIODS = [['24h', 'Últimas 24h'], ['7d', '7 dias'], ['30d', '30 dias'], ['90d', '90 dias'], ['all', 'Tudo']];

const delta = (cur, prev) => {
  if (prev == null || cur == null || !prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
};

// <input type="date"> → meia-noite local em ISO (o servidor exige fuso). `extraDays` torna o fim inclusivo.
const dayIso = (d, extraDays = 0) => {
  const dt = new Date(`${d}T00:00:00`);
  dt.setDate(dt.getDate() + extraDays);
  return dt.toISOString();
};

function Stat({ label, value, hint, change }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1">
        {change != null && <span className={change >= 0 ? 'text-green-500' : 'text-red-400'}>{change >= 0 ? '▲' : '▼'} {Math.abs(change)}% </span>}
        {hint}
      </div>
    </div>
  );
}

function Summary() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/revenue', { params: { period } }).then(r => setData(r.data)).catch(err => toast.error(formatApiError(err.response?.data?.detail)));
  }, [period]);
  const s = data?.summary || {};
  const p = data?.previous;
  const cur = data?.currency || 'BRL';
  return (
    <>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 w-[130px] text-xs" data-testid="revenue-period"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODS.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
        </Select>
        {p && <span className="text-[10px] text-muted-foreground">Setas comparam com o período anterior de mesmo tamanho.</span>}
        {data?.note && <span className="text-[10px] text-muted-foreground">{data.note}</span>}
      </div>
      <div className="stats-grid">
        <Stat label="DEPÓSITOS" value={money(s.deposits, cur)} hint={`${num(s.deposit_count)} depósitos`} change={delta(s.deposits, p?.deposits)} />
        <Stat label="FTDs" value={num(s.ftds)} hint={money(s.ftd_value, cur)} change={delta(s.ftds, p?.ftds)} />
        <Stat label="SAQUES" value={money(s.withdrawals, cur)} hint={`${num(s.withdrawal_count)} saques`} change={delta(s.withdrawals, p?.withdrawals)} />
        <Stat label="DEPÓSITO LÍQUIDO" value={money(s.net_deposit, cur)} hint="depósitos − saques" change={delta(s.net_deposit, p?.net_deposit)} />
        {period === 'all' && <>
          <Stat label="INVESTIMENTO" value={money(s.spend, cur)} hint="soma das campanhas" />
          <Stat label="CPFTD" value={money(s.cpftd, cur)} hint="investimento ÷ FTDs" />
          <Stat label="ROI" value={s.roi != null ? `${s.roi.toLocaleString('pt-BR')}%` : '—'} hint="(líquido − investimento) ÷ investimento" />
        </>}
      </div>
    </>
  );
}

function Cohorts() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/revenue/cohorts').then(r => setData(r.data)).catch(() => setData({ cohorts: [] })); }, []);
  const cur = data?.currency || 'BRL';
  return (
    <div className="stat-card" style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader><TableRow>
          {['Semana de entrada', 'Players', 'FTDs', 'Conversão', 'Depósitos', 'Saques', 'Líquido', 'Líquido por player'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>
          {data && data.cohorts.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-xs text-center text-muted-foreground py-8">Nenhum player ainda.</TableCell></TableRow>
          )}
          {(data?.cohorts || []).map(c => (
            <TableRow key={c.week} className="tabular-nums">
              <TableCell className="text-xs font-medium">{c.week}</TableCell>
              <TableCell className="text-xs">{num(c.players)}</TableCell>
              <TableCell className="text-xs">{num(c.ftds)}</TableCell>
              <TableCell className="text-xs">{c.ftd_rate != null ? `${c.ftd_rate}%` : '—'}</TableCell>
              <TableCell className="text-xs">{money(c.deposits, cur)}</TableCell>
              <TableCell className="text-xs">{money(c.withdrawals, cur)}</TableCell>
              <TableCell className="text-xs">{money(c.net, cur)}</TableCell>
              <TableCell className="text-xs">{money(c.ltv, cur)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function parseStatement(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('O arquivo não tem linhas de transação');
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]).map(h => h.toLowerCase());
  const idCol = head.findIndex(h => ['transaction_id', 'id', 'transacao', 'transação', 'id_transacao'].includes(h));
  const amountCol = head.findIndex(h => ['amount', 'valor', 'value'].includes(h));
  if (idCol < 0 || amountCol < 0) throw new Error('O CSV precisa das colunas transaction_id e amount (ou valor)');
  return lines.slice(1).map(split).map(c => ({ transaction_id: c[idCol], amount: c[amountCol] }));
}

function Reconciliation() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ start: '', end: '', rows: null, file: '' });
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/revenue/reconciliation').then(r => setItems(r.data.items)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const readFile = async (file) => {
    if (!file) return;
    try {
      const rows = parseStatement(await file.text());
      setForm(f => ({ ...f, rows, file: file.name }));
    }
    catch (e) { toast.error(e.message); }
  };
  const run = async (e) => {
    e.preventDefault();
    if (!form.rows) { toast.error('Escolha o extrato da casa (CSV)'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/revenue/reconciliation', {
        rows: form.rows, start: dayIso(form.start), end: dayIso(form.end, 1), label: form.file,
      });
      setDetail(data); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    setBusy(false);
  };
  const open = async (id) => {
    try { setDetail((await api.get(`/revenue/reconciliation/${id}`)).data); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };
  const r = detail?.result;
  return (
    <div className="space-y-4">
      <form onSubmit={run} className="stat-card p-4 grid gap-3 md:grid-cols-5 items-end">
        <div className="md:col-span-2"><Label className="text-xs">Extrato da casa (CSV com transaction_id e amount)</Label>
          <Input type="file" accept=".csv,text/csv" className="text-xs mt-1" onChange={e => readFile(e.target.files[0])} data-testid="recon-file" />
          {form.rows && <p className="text-[10px] text-muted-foreground mt-1">{form.file}: {num(form.rows.length)} linhas</p>}
        </div>
        <div><Label className="text-xs">De</Label><Input type="date" required className="text-xs mt-1" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} /></div>
        <div><Label className="text-xs">Até</Label><Input type="date" required className="text-xs mt-1" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></div>
        <Button type="submit" disabled={busy} data-testid="recon-run">{busy ? 'Conferindo…' : 'Conciliar'}</Button>
      </form>
      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>{['Feita em', 'Período', 'Transações', 'Batem', 'Diferença', 'Status'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-8">Nenhuma conciliação. Envie o extrato da casa para conferir com os postbacks recebidos.</TableCell></TableRow>
            )}
            {items.map(i => (
              <TableRow key={i._id} className="cursor-pointer tabular-nums" onClick={() => open(i._id)}>
                <TableCell className="text-[10px]">{new Date(i.created_at).toLocaleString('pt-BR')}</TableCell>
                <TableCell className="text-[10px]">{new Date(i.start).toLocaleDateString('pt-BR')} – {new Date(new Date(i.end) - 1).toLocaleDateString('pt-BR')}</TableCell>
                <TableCell className="text-xs">{num(i.result.file_rows)}</TableCell>
                <TableCell className="text-xs">{num(i.result.matched)}</TableCell>
                <TableCell className="text-xs">{money(i.result.difference)}</TableCell>
                <TableCell><Badge className={`text-[9px] ${i.result.status === 'ok' ? 'badge-success' : 'badge-warning'}`}>{i.result.status === 'ok' ? 'Bate' : 'Divergente'}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Conciliação · {r?.status === 'ok' ? 'tudo bate' : 'divergente'}</DialogTitle></DialogHeader>
          {r && (
            <div className="space-y-3 text-xs max-h-[70vh] overflow-auto">
              <p className="tabular-nums">Extrato {money(r.file_total)} · Ledger {money(r.ledger_total)} · Diferença <strong>{money(r.difference)}</strong> · {num(r.matched)} de {num(r.file_rows)} transações batem</p>
              {[['Valor diferente', r.mismatched, m => `${money(m.file_amount)} na casa × ${money(m.ledger_amount)} no ledger`],
                ['Na casa, sem postback recebido', r.missing_in_ledger, m => money(m.file_amount)],
                ['Postback sem linha no extrato', r.missing_in_file, m => money(m.ledger_amount)]].map(([title, list, fmt]) => (
                <div key={title}>
                  <p className="font-medium">{title} ({(list || []).length})</p>
                  {(list || []).slice(0, 200).map(m => <p key={m.transaction_id} className="text-[10px] font-mono text-muted-foreground">{m.transaction_id} — {fmt(m)}</p>)}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClosedPeriods() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ start: '', end: '', label: '' });
  const load = useCallback(() => api.get('/revenue/periods').then(r => setItems(r.data.items)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const close = async (e) => {
    e.preventDefault();
    if (!window.confirm('Fechar o período grava os números como estão agora e eles não mudam mais. Continuar?')) return;
    try {
      await api.post('/revenue/periods', { start: dayIso(form.start), end: dayIso(form.end, 1), label: form.label });
      toast.success('Período fechado'); setForm({ start: '', end: '', label: '' }); load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };
  return (
    <div className="space-y-4">
      <form onSubmit={close} className="stat-card p-4 grid gap-3 md:grid-cols-4 items-end">
        <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" placeholder="Agosto/2026" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></div>
        <div><Label className="text-xs">De</Label><Input type="date" required className="text-xs mt-1" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} /></div>
        <div><Label className="text-xs">Até</Label><Input type="date" required className="text-xs mt-1" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></div>
        <Button type="submit" data-testid="close-period">Fechar período</Button>
      </form>
      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>{['Período', 'Depósitos', 'FTDs', 'Saques', 'Líquido', 'Fechado por'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-8">Nenhum período fechado.</TableCell></TableRow>
            )}
            {items.map(i => (
              <TableRow key={i._id} className="tabular-nums">
                <TableCell className="text-xs font-medium">{i.label}</TableCell>
                <TableCell className="text-xs">{money(i.summary.deposits)}</TableCell>
                <TableCell className="text-xs">{num(i.summary.ftds)}</TableCell>
                <TableCell className="text-xs">{money(i.summary.withdrawals)}</TableCell>
                <TableCell className="text-xs">{money(i.summary.net_deposit)}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{i.closed_by_name} · {new Date(i.closed_at).toLocaleDateString('pt-BR')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function RevenuePage() {
  return (
    <div data-testid="revenue-page">
      <div className="page-header">
        <div>
          <h1>Receita<span className="accent">.</span></h1>
          <p className="page-description">Depósitos, FTDs, coortes e conferência com o extrato da casa.</p>
        </div>
      </div>
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary" className="text-xs">Resumo</TabsTrigger>
          <TabsTrigger value="cohorts" className="text-xs">Coortes</TabsTrigger>
          <TabsTrigger value="reconciliation" className="text-xs">Conciliação</TabsTrigger>
          <TabsTrigger value="periods" className="text-xs">Períodos fechados</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-4"><Summary /></TabsContent>
        <TabsContent value="cohorts" className="mt-4"><Cohorts /></TabsContent>
        <TabsContent value="reconciliation" className="mt-4"><Reconciliation /></TabsContent>
        <TabsContent value="periods" className="mt-4"><ClosedPeriods /></TabsContent>
      </Tabs>
    </div>
  );
}
