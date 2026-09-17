import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
import { money, num } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { FileText, Plus, Trash2, Calendar, Download, Play, History } from 'lucide-react';
import { toast } from 'sonner';

const PERIOD_LABELS = { '1d': 'Últimas 24h', '7d': '7 dias', '30d': '30 dias', '90d': '90 dias' };
const MONEY_METRICS = new Set(['ftd_value', 'deposits', 'withdrawals', 'net_deposits']);
const WEEKDAYS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const EMPTY = { name: '', period: '7d', metrics: ['clicks', 'registrations', 'ftds', 'net_deposits'], dimensions: ['source'] };

const describeSchedule = (s) => {
  if (!s) return '—';
  const at = `${String(s.hour).padStart(2, '0')}h`;
  if (s.frequency === 'daily') return `Todo dia ${at}`;
  if (s.frequency === 'weekly') return `Toda ${WEEKDAYS[s.weekday]} ${at}`;
  return `Dia ${s.day} ${at}`;
};

const toggle = (list, value) => (list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

function SnapshotView({ snap, onClose }) {
  const download = async () => {
    try {
      const { data } = await api.get(`/reports/${snap.report_id}/snapshots/${snap._id}/export.csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${(snap.report_name || 'relatorio').replace(/\s+/g, '_')}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Não foi possível baixar o CSV'); }
  };
  return (
    <Dialog open={!!snap} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{snap?.report_name}</DialogTitle>
          {snap && <p className="text-[10px] text-muted-foreground">
            {new Date(snap.start).toLocaleString('pt-BR')} – {new Date(snap.end).toLocaleString('pt-BR')} · gerado em {new Date(snap.generated_at).toLocaleString('pt-BR')} ({snap.trigger === 'scheduled' ? 'agendado' : 'manual'})
          </p>}
        </DialogHeader>
        {snap && (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader><TableRow>{snap.columns.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {snap.rows.length === 0 && <TableRow><TableCell colSpan={snap.columns.length} className="text-xs text-center text-muted-foreground py-6">Nenhum evento no período.</TableCell></TableRow>}
                {snap.rows.map((row, i) => (
                  <TableRow key={i} className="tabular-nums">
                    {snap.columns.map(c => (
                      <TableCell key={c.key} className="text-xs">
                        {MONEY_METRICS.has(c.key) ? money(row[c.key], snap.currency) : typeof row[c.key] === 'number' ? num(row[c.key]) : row[c.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={download} data-testid="snapshot-csv"><Download size={13} className="mr-2" /> Baixar CSV</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReportsPage() {
  const [items, setItems] = useState([]);
  const [catalog, setCatalog] = useState({ metrics: {}, dimensions: {} });
  const [form, setForm] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [history, setHistory] = useState(null);
  const [snap, setSnap] = useState(null);
  const [running, setRunning] = useState(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    try { const { data } = await api.get('/reports'); setItems(data.items); setCatalog(data.catalog); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  // Link da notificação "Relatório pronto" abre o snapshot direto.
  useEffect(() => {
    const report = params.get('report');
    const snapshot = params.get('snapshot');
    if (report && snapshot) {
      api.get(`/reports/${report}/snapshots/${snapshot}`).then(r => setSnap(r.data)).catch(() => toast.error('Snapshot não encontrado'));
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const fail = err => toast.error(formatApiError(err.response?.data?.detail));

  const create = async (e) => {
    e.preventDefault();
    if (!form.metrics.length) { toast.error('Escolha ao menos uma métrica'); return; }
    try { await api.post('/reports', form); toast.success('Relatório criado'); setForm(null); load(); } catch (err) { fail(err); }
  };
  const run = async (r) => {
    setRunning(r._id);
    try { setSnap((await api.post(`/reports/${r._id}/run`)).data); load(); } catch (err) { fail(err); }
    setRunning(null);
  };
  const saveSchedule = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/reports/${scheduling.report._id}/schedule`, scheduling.form);
      toast.success(scheduling.form.frequency === 'none' ? 'Agendamento removido' : 'Agendado');
      setScheduling(null); load();
    } catch (err) { fail(err); }
  };
  const openHistory = async (r) => {
    try { const { data } = await api.get(`/reports/${r._id}/snapshots`); setHistory({ report: r, items: data.items }); } catch (err) { fail(err); }
  };
  const openSnapshot = async (reportId, id) => {
    try { setSnap((await api.get(`/reports/${reportId}/snapshots/${id}`)).data); } catch (err) { fail(err); }
  };
  const remove = async (id) => {
    if (!window.confirm('Remover o relatório e todo o histórico dele?')) return;
    try { await api.delete(`/reports/${id}`); toast.success('Removido'); load(); } catch (err) { fail(err); }
  };
  const sf = scheduling?.form;
  const setSf = patch => setScheduling(s => ({ ...s, form: { ...s.form, ...patch } }));

  return (
    <div data-testid="reports-page">
      <div className="page-header">
        <div><h1>Relatórios<span className="accent">.</span></h1><p className="page-description">Monte, execute, agende e exporte. Cada execução fica guardada.</p></div>
        <Button onClick={() => setForm(EMPTY)} data-testid="create-report-btn"><Plus size={14} className="mr-2" /> Novo relatório</Button>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            {['Nome', 'Período', 'Quebra por', 'Métricas', 'Agenda', 'Última execução'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><FileText size={32} /><h3>Nenhum relatório</h3><p>Escolha métricas e como quebrar (fonte, dia, campanha, link).</p></div></TableCell></TableRow>
            )}
            {items.map(r => (
              <TableRow key={r._id}>
                <TableCell className="text-xs font-medium">{r.name}</TableCell>
                <TableCell className="text-xs">{PERIOD_LABELS[r.period] || r.period}</TableCell>
                <TableCell className="text-[10px]">{(r.dimensions || []).map(d => catalog.dimensions[d] || d).join(' × ') || 'Fonte'}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{(r.metrics || []).map(m => catalog.metrics[m] || m).join(', ')}</TableCell>
                <TableCell className="text-[10px]">
                  {r.schedule ? <Badge variant="outline" className="text-[9px]">{describeSchedule(r.schedule)}</Badge> : '—'}
                  {r.schedule?.last_error && <p className="text-destructive text-[9px]">{r.schedule.last_error}</p>}
                </TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{r.last_run_at ? new Date(r.last_run_at).toLocaleString('pt-BR') : 'nunca'}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Executar agora" disabled={running === r._id} onClick={() => run(r)} data-testid={`run-report-${r._id}`}><Play size={13} /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Agendar" onClick={() => setScheduling({ report: r, form: { frequency: r.schedule?.frequency || 'daily', hour: r.schedule?.hour ?? 8, weekday: r.schedule?.weekday ?? 0, day: r.schedule?.day ?? 1 } })}><Calendar size={13} /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Histórico" onClick={() => openHistory(r)}><History size={13} /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Remover" onClick={() => remove(r._id)}><Trash2 size={13} /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent data-testid="create-report-dialog">
          <DialogHeader><DialogTitle>Novo relatório</DialogTitle></DialogHeader>
          {form && (
            <form onSubmit={create} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
                <div><Label className="text-xs">Período</Label>
                  <Select value={form.period} onValueChange={v => setForm(f => ({ ...f, period: v }))}>
                    <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PERIOD_LABELS).map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Quebrar por (até 2)</Label>
                <div className="flex flex-wrap gap-3 mt-1">
                  {Object.entries(catalog.dimensions).map(([k, l]) => (
                    <label key={k} className="flex items-center gap-1.5 text-xs">
                      <Checkbox checked={form.dimensions.includes(k)} disabled={!form.dimensions.includes(k) && form.dimensions.length >= 2}
                        onCheckedChange={() => setForm(f => ({ ...f, dimensions: toggle(f.dimensions, k) }))} />{l}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Métricas</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {Object.entries(catalog.metrics).map(([k, l]) => (
                    <label key={k} className="flex items-center gap-1.5 text-xs">
                      <Checkbox checked={form.metrics.includes(k)} onCheckedChange={() => setForm(f => ({ ...f, metrics: toggle(f.metrics, k) }))} />{l}
                    </label>
                  ))}
                </div>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" data-testid="submit-report">Criar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduling} onOpenChange={o => !o && setScheduling(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Agendar · {scheduling?.report.name}</DialogTitle></DialogHeader>
          {sf && (
            <form onSubmit={saveSchedule} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Frequência</Label>
                  <Select value={sf.frequency} onValueChange={v => setSf({ frequency: v })}>
                    <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily" className="text-xs">Diário</SelectItem>
                      <SelectItem value="weekly" className="text-xs">Semanal</SelectItem>
                      <SelectItem value="monthly" className="text-xs">Mensal</SelectItem>
                      <SelectItem value="none" className="text-xs">Sem agendamento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {sf.frequency !== 'none' && (
                  <div><Label className="text-xs">Hora (fuso do workspace)</Label>
                    <Input type="number" min={0} max={23} className="text-xs mt-1" value={sf.hour} onChange={e => setSf({ hour: e.target.value })} />
                  </div>
                )}
                {sf.frequency === 'weekly' && (
                  <div><Label className="text-xs">Dia da semana</Label>
                    <Select value={String(sf.weekday)} onValueChange={v => setSf({ weekday: Number(v) })}>
                      <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={d} value={String(i)} className="text-xs">{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {sf.frequency === 'monthly' && (
                  <div><Label className="text-xs">Dia do mês (1–28)</Label>
                    <Input type="number" min={1} max={28} className="text-xs mt-1" value={sf.day} onChange={e => setSf({ day: e.target.value })} />
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">Quando o relatório roda, o time recebe a notificação com o link para o resultado.</p>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setScheduling(null)}>Cancelar</Button><Button type="submit">Salvar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={o => !o && setHistory(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Histórico · {history?.report.name}</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-auto">
            {history?.items.length === 0 && <p className="text-xs text-muted-foreground">Ainda não executado.</p>}
            {(history?.items || []).map(s => (
              <button key={s._id} type="button" className="block w-full text-left text-xs py-1.5 border-b border-border hover:text-primary"
                onClick={() => openSnapshot(history.report._id, s._id)}>
                {new Date(s.generated_at).toLocaleString('pt-BR')} <span className="text-muted-foreground">· {s.trigger === 'scheduled' ? 'agendado' : 'manual'}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <SnapshotView snap={snap} onClose={() => setSnap(null)} />
    </div>
  );
}
