import { useCallback, useEffect, useState } from 'react';
import api, { formatApiError } from '@/lib/api';
import { money, num } from '@/lib/utils';
import { statusLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Download, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const fail = err => toast.error(formatApiError(err.response?.data?.detail));
const when = v => (v ? new Date(v).toLocaleString('pt-BR') : '—');
const USAGE_STYLE = { over: 'badge-error', warning: 'badge-warning', ok: 'badge-success', unlimited: '' };

/** Planos versionados: preço, direitos e limites; editar cria uma versão nova. */
export function PlansPanel() {
  const [data, setData] = useState({ items: [], meters: {} });
  const [form, setForm] = useState(null);
  const [versions, setVersions] = useState(null);
  const load = useCallback(() => api.get('/admin/plans').then(r => setData(r.data)).catch(fail), []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    const payload = {
      name: form.name, price: Number(form.price) || 0,
      features: (form.features || '').split(',').map(f => f.trim()).filter(Boolean),
      limits: Object.fromEntries(Object.entries(form.limits || {}).map(([k, v]) => [k, Number(v) || null])),
      overage: Object.fromEntries(Object.entries(form.overage || {}).map(([k, v]) => [k, Number(v) || 0])),
    };
    try {
      if (form._id) {
        const { data: res } = await api.put(`/admin/plans/${form._id}`, payload);
        toast.success(res.changes ? `Versão ${res.version}: ${res.changes.join(', ')}` : 'Nada mudou');
      } else {
        await api.post('/admin/plans', payload);
        toast.success('Plano criado');
      }
      setForm(null); load();
    } catch (err) { fail(err); }
  };

  const openVersions = async (plan) => {
    try { const { data: res } = await api.get(`/admin/plans/${plan._id}/versions`); setVersions({ plan, items: res.items }); }
    catch (err) { fail(err); }
  };

  const edit = plan => setForm({ ...plan, features: (plan.features || []).join(', '), limits: plan.limits || {}, overage: plan.overage || {} });

  return (
    <div className="stat-card" style={{ overflow: 'auto' }}>
      <div className="flex items-center justify-between p-3">
        <p className="text-[10px] text-muted-foreground">Cada alteração vira uma versão nova. Faturas já emitidas continuam na versão em que foram cobradas.</p>
        <Button size="sm" onClick={() => setForm({ name: '', price: 0, features: '', limits: {}, overage: {} })} data-testid="create-plan">
          <Plus size={13} className="mr-1" /> Novo plano
        </Button>
      </div>
      <Table>
        <TableHeader><TableRow>{['Plano', 'Versão', 'Preço', 'Direitos', 'Limites', 'Tenants', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {data.items.length === 0 && <TableRow><TableCell colSpan={7} className="text-xs text-center text-muted-foreground py-8">Nenhum plano cadastrado.</TableCell></TableRow>}
          {data.items.map(plan => (
            <TableRow key={plan._id}>
              <TableCell className="text-xs font-medium"><button type="button" onClick={() => edit(plan)}>{plan.name}</button></TableCell>
              <TableCell className="text-[10px]"><button type="button" className="hover:text-primary" onClick={() => openVersions(plan)}>v{plan.version}</button></TableCell>
              <TableCell className="text-xs tabular-nums">{money(plan.price, plan.currency)}</TableCell>
              <TableCell className="text-[10px] text-muted-foreground">{(plan.features || []).join(', ') || '—'}</TableCell>
              <TableCell className="text-[10px] text-muted-foreground">
                {Object.entries(plan.limits || {}).map(([k, v]) => `${data.meters[k] || k}: ${v ? num(v) : 'ilimitado'}`).join(' · ') || 'sem limites'}
              </TableCell>
              <TableCell className="text-xs">{plan.tenants}</TableCell>
              <TableCell className="text-right"><Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => edit(plan)}>Editar</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?._id ? `Editar ${form.name}` : 'Novo plano'}</DialogTitle></DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Nome</Label><Input required disabled={!!form._id} className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><Label className="text-xs">Preço mensal</Label><Input type="number" min={0} step="0.01" className="text-xs mt-1" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></div>
              </div>
              <div><Label className="text-xs">Direitos (separados por vírgula)</Label><Input className="text-xs mt-1" placeholder="inbox, automações, ia" value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} /></div>
              <div>
                <Label className="text-xs">Limites e preço do excedente</Label>
                <div className="space-y-2 mt-1">
                  {Object.entries(data.meters).map(([key, label]) => (
                    <div key={key} className="grid grid-cols-[1fr_110px_110px] gap-2 items-center">
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                      <Input type="number" min={0} className="text-xs h-8" placeholder="ilimitado"
                        value={form.limits?.[key] ?? ''} onChange={e => setForm(f => ({ ...f, limits: { ...f.limits, [key]: e.target.value } }))} />
                      <Input type="number" min={0} step="0.01" className="text-xs h-8" placeholder="R$ excedente"
                        value={form.overage?.[key] ?? ''} onChange={e => setForm(f => ({ ...f, overage: { ...f.overage, [key]: e.target.value } }))} />
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" data-testid="submit-plan">Salvar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={!!versions} onOpenChange={o => !o && setVersions(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle className="text-base">Versões de {versions?.plan.name}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-2">
            {(versions?.items || []).map(v => (
              <div key={v._id} className="dns-record">
                <div className="dns-record-head"><span className="text-[10px] font-medium">v{v.version}</span><span className="text-[9px] text-muted-foreground">{when(v.at)}</span></div>
                <p className="text-[10px]">{(v.changes || []).join(' · ')}</p>
                <p className="text-[9px] text-muted-foreground">por {v.by || '—'}</p>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Uso medido por tenant no mês e as faturas geradas a partir dele. */
export function BillingPanel() {
  const [month, setMonth] = useState('');
  const [usage, setUsage] = useState({ items: [], meters: {} });
  const [invoices, setInvoices] = useState({ items: [], status_labels: {} });
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = month ? { month } : {};
      const [u, i] = await Promise.all([api.get('/admin/usage', { params }), api.get('/admin/invoices', { params })]);
      setUsage(u.data); setInvoices(i.data);
      if (!month) setMonth(u.data.month);
    } catch (err) { fail(err); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!window.confirm(`Gerar faturas de ${month}? Tenants que já têm fatura no mês são pulados.`)) return;
    try {
      const { data } = await api.post('/admin/invoices/generate', { month });
      toast.success(`${data.created} faturas geradas, ${data.skipped} já existiam`);
      load();
    } catch (err) { fail(err); }
  };

  const setStatus = async (invoice, status) => {
    try { await api.put(`/admin/invoices/${invoice._id}`, { status }); load(); } catch (err) { fail(err); }
  };

  const download = async (invoice) => {
    try {
      const { data } = await api.get(`/admin/invoices/${invoice._id}/export.csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      Object.assign(document.createElement('a'), { href: url, download: `fatura_${invoice.month}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Não foi possível baixar'); }
  };

  return (
    <div className="space-y-4">
      <div className="data-toolbar">
        <Input type="month" className="h-8 w-[150px] text-xs" value={month} onChange={e => setMonth(e.target.value)} data-testid="billing-month" />
        <Button size="sm" onClick={generate} data-testid="generate-invoices">Gerar faturas do mês</Button>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <p className="text-xs font-medium p-3">Uso medido</p>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Tenant</TableHead>
            <TableHead className="text-xs">Plano</TableHead>
            {Object.values(usage.meters).map(label => <TableHead key={label} className="text-xs text-right">{label}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {usage.items.map(row => (
              <TableRow key={row.workspace_id}>
                <TableCell className="text-xs font-medium">{row.name}</TableCell>
                <TableCell className="text-[10px]">{row.plan}</TableCell>
                {Object.keys(usage.meters).map(meter => {
                  const cell = row.usage[meter] || {};
                  return (
                    <TableCell key={meter} className="text-xs text-right tabular-nums">
                      <Badge className={`text-[9px] ${USAGE_STYLE[cell.state] || ''}`}>
                        {num(cell.used)}{cell.limit ? ` / ${num(cell.limit)}` : ''}
                      </Badge>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <p className="text-xs font-medium p-3">Faturas</p>
        <Table>
          <TableHeader><TableRow>{['Tenant', 'Mês', 'Plano', 'Total', 'Situação', 'Vence', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {invoices.items.length === 0 && <TableRow><TableCell colSpan={7} className="text-xs text-center text-muted-foreground py-8">Nenhuma fatura gerada.</TableCell></TableRow>}
            {invoices.items.map(invoice => (
              <TableRow key={invoice._id}>
                <TableCell className="text-xs font-medium"><button type="button" onClick={() => setDetail(invoice)}>{invoice.workspace_name}</button></TableCell>
                <TableCell className="text-[10px]">{invoice.month}</TableCell>
                <TableCell className="text-[10px]">{invoice.plan} v{invoice.plan_version}</TableCell>
                <TableCell className="text-xs tabular-nums">{money(invoice.total, invoice.currency)}</TableCell>
                <TableCell><Badge className={`text-[9px] ${invoice.status === 'paid' ? 'badge-success' : invoice.status === 'overdue' ? 'badge-error' : 'badge-warning'}`}>{invoices.status_labels[invoice.status] || invoice.status}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{when(invoice.due_at)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {invoice.status !== 'paid' && <Button size="sm" variant="outline" className="text-[10px] h-7 mr-1" onClick={() => setStatus(invoice, 'paid')}>Marcar paga</Button>}
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Baixar" onClick={() => download(invoice)}><Download size={12} /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle className="text-base">{detail?.workspace_name} · {detail?.month}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-3">
            {(detail?.lines || []).map((line, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 text-xs border-b border-border pb-2">
                <span>{line.description}{line.quantity > 1 ? ` · ${num(line.quantity)}` : ''}</span>
                <strong className="tabular-nums">{money(line.total, detail.currency)}</strong>
              </div>
            ))}
            <div className="flex items-baseline justify-between text-sm"><span>Total</span><strong>{money(detail?.total, detail?.currency)}</strong></div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Roteamento de modelos, biblioteca de prompts, custo estimado e guardrails. */
export function AiOpsPanel() {
  const [data, setData] = useState(null);
  const [routing, setRouting] = useState({});
  const [guardrails, setGuardrails] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/admin/ai');
      setData(res); setRouting(res.routing); setGuardrails(res.guardrails);
    } catch (err) { fail(err); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;

  const saveRouting = async () => {
    try { await api.put('/admin/ai/routing', routing); toast.success('Roteamento salvo'); load(); } catch (err) { fail(err); }
  };
  const saveGuardrails = async () => {
    try { await api.put('/admin/ai/guardrails', guardrails); toast.success('Guardrails salvos'); load(); } catch (err) { fail(err); }
  };
  const savePrompt = async (e) => {
    e.preventDefault();
    try { await api.post('/admin/ai/prompts', prompt); toast.success('Prompt salvo'); setPrompt(null); load(); } catch (err) { fail(err); }
  };

  return (
    <div className="space-y-4">
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">TOKENS NO MÊS</div><div className="stat-value">{num(data.total_tokens)}</div><div className="text-[10px] text-muted-foreground mt-1">estimativa por texto</div></div>
        <div className="stat-card"><div className="stat-label">CUSTO ESTIMADO</div><div className="stat-value">US$ {data.total_cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>
        <div className="stat-card"><div className="stat-label">LIMITE DA PLATAFORMA</div>
          <div className="stat-value">{data.cap_state.percent === null ? 'sem limite' : `${data.cap_state.percent}%`}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{data.cap_state.limit ? `${num(data.cap_state.used)} de ${num(data.cap_state.limit)} tokens` : 'ilimitado'}</div>
        </div>
      </div>

      <div className="stat-card p-4 space-y-3">
        <p className="text-xs font-medium">Qual modelo atende cada coisa</p>
        {Object.entries(data.tasks).map(([task, label]) => (
          <div key={task} className="grid grid-cols-[1fr_220px] gap-3 items-center">
            <span className="text-[11px]">{label}</span>
            <Select value={(routing[task] || {}).model} onValueChange={v => setRouting(r => ({ ...r, [task]: { provider: Object.keys(data.models).includes(v) && v.startsWith('claude') ? 'anthropic' : 'openai', model: v } }))}>
              <SelectTrigger className="h-8 text-xs" data-testid={`routing-${task}`}><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(data.models).map(model => <SelectItem key={model} value={model} className="text-xs">{model}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
        <Button size="sm" onClick={saveRouting} data-testid="save-routing">Salvar roteamento</Button>
      </div>

      <div className="stat-card p-4 space-y-3">
        <p className="text-xs font-medium">Guardrails</p>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Teto de tokens no mês</Label><Input type="number" min={0} className="text-xs mt-1" value={guardrails.monthly_token_cap} onChange={e => setGuardrails(g => ({ ...g, monthly_token_cap: e.target.value }))} /></div>
          <div><Label className="text-xs">Máx. palavras por resposta</Label><Input type="number" min={20} className="text-xs mt-1" value={guardrails.max_reply_words} onChange={e => setGuardrails(g => ({ ...g, max_reply_words: e.target.value }))} /></div>
        </div>
        <div><Label className="text-xs">Termos proibidos (vírgula)</Label>
          <Input className="text-xs mt-1" value={(guardrails.blocked_terms || []).join(', ')}
            onChange={e => setGuardrails(g => ({ ...g, blocked_terms: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))} />
          <p className="text-[9px] text-muted-foreground mt-1">Se a IA escrever um destes termos, a resposta não é enviada e a conversa vai para um humano.</p>
        </div>
        <label className="flex items-center justify-between text-xs">
          Falar de pagamento só com humano
          <Switch checked={!!guardrails.require_human_for_payment} onCheckedChange={v => setGuardrails(g => ({ ...g, require_human_for_payment: v }))} />
        </label>
        <Button size="sm" onClick={saveGuardrails} data-testid="save-guardrails">Salvar guardrails</Button>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="flex items-center justify-between p-3">
          <p className="text-xs font-medium">Prompts da plataforma</p>
          <Button size="sm" onClick={() => setPrompt({ name: '', task: 'agent', content: '' })}><Plus size={13} className="mr-1" /> Novo prompt</Button>
        </div>
        <Table>
          <TableHeader><TableRow>{['Nome', 'Usado em', 'Conteúdo', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.prompts.length === 0 && <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-6">Nenhum prompt salvo.</TableCell></TableRow>}
            {data.prompts.map(p => (
              <TableRow key={p._id}>
                <TableCell className="text-xs font-medium">{p.name}</TableCell>
                <TableCell className="text-[10px]">{data.tasks[p.task] || p.task}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground max-w-[380px] truncate">{p.content}</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={async () => { await api.delete(`/admin/ai/prompts/${p._id}`); load(); }}><Trash2 size={12} /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <p className="text-xs font-medium p-3">Consumo por tenant</p>
        <Table>
          <TableHeader><TableRow>{['Tenant', 'Respostas', 'Tokens', 'Custo estimado'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.by_workspace.length === 0 && <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-6">Nenhum uso de IA neste mês.</TableCell></TableRow>}
            {data.by_workspace.map(row => (
              <TableRow key={row.workspace_id}>
                <TableCell className="text-xs">{row.name}</TableCell>
                <TableCell className="text-xs">{num(row.calls)}</TableCell>
                <TableCell className="text-xs">{num(row.tokens)}</TableCell>
                <TableCell className="text-xs">US$ {row.cost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!prompt} onOpenChange={o => !o && setPrompt(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo prompt</DialogTitle></DialogHeader>
          {prompt && (
            <form onSubmit={savePrompt} className="space-y-3">
              <div><Label className="text-xs">Nome</Label><Input required className="text-xs mt-1" value={prompt.name} onChange={e => setPrompt(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label className="text-xs">Usado em</Label>
                <Select value={prompt.task} onValueChange={v => setPrompt(p => ({ ...p, task: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(data.tasks).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Conteúdo</Label><Textarea required rows={6} className="text-xs mt-1" value={prompt.content} onChange={e => setPrompt(p => ({ ...p, content: e.target.value }))} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setPrompt(null)}>Cancelar</Button><Button type="submit">Salvar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** SLOs medidos, incidentes e releases. */
export function ReliabilityPanel() {
  const [data, setData] = useState(null);
  const [incident, setIncident] = useState(null);
  const [release, setRelease] = useState(null);
  const load = useCallback(() => api.get('/admin/reliability').then(r => setData(r.data)).catch(fail), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;

  const openIncident = async (e) => {
    e.preventDefault();
    try { await api.post('/admin/incidents', incident); toast.success('Incidente aberto'); setIncident(null); load(); } catch (err) { fail(err); }
  };
  const update = async (item, status) => {
    const text = window.prompt('O que houve nessa atualização?') ?? '';
    try { await api.post(`/admin/incidents/${item._id}/update`, { status, text }); load(); } catch (err) { fail(err); }
  };
  const saveRelease = async (e) => {
    e.preventDefault();
    try { await api.post('/admin/releases', release); toast.success('Release publicada'); setRelease(null); load(); } catch (err) { fail(err); }
  };

  return (
    <div className="space-y-4">
      <div className="stats-grid">
        {data.slos.map(slo => (
          <div key={slo.key} className="stat-card">
            <div className="stat-label">{slo.name.toUpperCase()}</div>
            <div className="stat-value">{slo.measured === null ? '—' : `${slo.measured}%`}</div>
            <div className={`text-[10px] mt-1 ${slo.state === 'ok' ? 'text-emerald-400' : slo.state === 'breached' ? 'text-red-400' : 'text-amber-400'}`}>
              meta {slo.target}% · {slo.state === 'ok' ? 'dentro da meta' : slo.state === 'at_risk' ? 'no limite' : slo.state === 'breached' ? 'abaixo da meta' : 'sem dados'}
            </div>
          </div>
        ))}
        <div className="stat-card"><div className="stat-label">AMOSTRAS</div><div className="stat-value">{num(data.samples.samples)}</div><div className="text-[10px] text-muted-foreground mt-1">{data.samples.down} falhas em {data.days} dias</div></div>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="flex items-center justify-between p-3">
          <p className="text-xs font-medium">Incidentes</p>
          <Button size="sm" onClick={() => setIncident({ title: '', impact: 'minor', detail: '' })} data-testid="create-incident"><Plus size={13} className="mr-1" /> Abrir incidente</Button>
        </div>
        <Table>
          <TableHeader><TableRow>{['Título', 'Impacto', 'Situação', 'Início', 'Duração', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.incidents.length === 0 && <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-6">Nenhum incidente registrado.</TableCell></TableRow>}
            {data.incidents.map(item => (
              <TableRow key={item._id}>
                <TableCell className="text-xs font-medium">{item.title}</TableCell>
                <TableCell className="text-[10px]">{data.impact_labels[item.impact]}</TableCell>
                <TableCell><Badge className={`text-[9px] ${item.status === 'resolved' ? 'badge-success' : 'badge-warning'}`}>{data.status_labels[item.status]}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{when(item.started_at)}</TableCell>
                <TableCell className="text-[10px]">{item.duration_min ?? '—'} min</TableCell>
                <TableCell className="text-right">
                  {item.status !== 'resolved' && (
                    <Select onValueChange={v => update(item, v)}>
                      <SelectTrigger className="h-7 w-[150px] text-[10px]"><SelectValue placeholder="Atualizar" /></SelectTrigger>
                      <SelectContent>{Object.entries(data.status_labels).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="flex items-center justify-between p-3">
          <p className="text-xs font-medium">Releases</p>
          <Button size="sm" onClick={() => setRelease({ version: '', title: '', notes: '' })}><Plus size={13} className="mr-1" /> Nova release</Button>
        </div>
        <Table>
          <TableHeader><TableRow>{['Versão', 'Título', 'Notas', 'Publicada'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.releases.length === 0 && <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-6">Nenhuma release publicada.</TableCell></TableRow>}
            {data.releases.map(item => (
              <TableRow key={item._id}>
                <TableCell className="text-xs font-medium">{item.version}</TableCell>
                <TableCell className="text-xs">{item.title}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground max-w-[420px] truncate">{item.notes}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{when(item.released_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!incident} onOpenChange={o => !o && setIncident(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Abrir incidente</DialogTitle></DialogHeader>
          {incident && (
            <form onSubmit={openIncident} className="space-y-3">
              <div><Label className="text-xs">Título</Label><Input required className="text-xs mt-1" value={incident.title} onChange={e => setIncident(i => ({ ...i, title: e.target.value }))} /></div>
              <div><Label className="text-xs">Impacto</Label>
                <Select value={incident.impact} onValueChange={v => setIncident(i => ({ ...i, impact: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(data.impact_labels).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">O que está acontecendo</Label><Textarea rows={3} className="text-xs mt-1" value={incident.detail} onChange={e => setIncident(i => ({ ...i, detail: e.target.value }))} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setIncident(null)}>Cancelar</Button><Button type="submit">Abrir</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!release} onOpenChange={o => !o && setRelease(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova release</DialogTitle></DialogHeader>
          {release && (
            <form onSubmit={saveRelease} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Versão</Label><Input required className="text-xs mt-1" placeholder="2026.09.1" value={release.version} onChange={e => setRelease(r => ({ ...r, version: e.target.value }))} /></div>
                <div><Label className="text-xs">Título</Label><Input className="text-xs mt-1" value={release.title} onChange={e => setRelease(r => ({ ...r, title: e.target.value }))} /></div>
              </div>
              <div><Label className="text-xs">Notas</Label><Textarea rows={5} className="text-xs mt-1" value={release.notes} onChange={e => setRelease(r => ({ ...r, notes: e.target.value }))} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setRelease(null)}>Cancelar</Button><Button type="submit">Publicar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Chamados, comunicados, pedidos de titular (LGPD) e equipe global. */
export function SupportPanel() {
  const [data, setData] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [announcement, setAnnouncement] = useState(null);
  const [dsr, setDsr] = useState(null);
  const load = useCallback(() => api.get('/admin/support').then(r => setData(r.data)).catch(fail), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;

  const reply = async (e) => {
    e.preventDefault();
    try { await api.post(`/admin/support/tickets/${ticket._id}/reply`, { text: ticket.reply }); toast.success('Resposta enviada'); setTicket(null); load(); }
    catch (err) { fail(err); }
  };
  const send = async (e) => {
    e.preventDefault();
    try { const { data: res } = await api.post('/admin/announcements', announcement); toast.success(`Comunicado enviado para ${res.workspaces} workspaces`); setAnnouncement(null); load(); }
    catch (err) { fail(err); }
  };
  const createDsr = async (e) => {
    e.preventDefault();
    try { await api.post('/admin/dsr', dsr); toast.success('Pedido registrado'); setDsr(null); load(); } catch (err) { fail(err); }
  };
  const runDsr = async (item) => {
    if (!window.confirm(item.type === 'delete' ? 'Apagar os dados deste titular? Não dá para desfazer.' : 'Gerar a exportação dos dados?')) return;
    try {
      if (item.type === 'export') {
        const { data: blob } = await api.post(`/admin/dsr/${item._id}/run`, {}, { responseType: 'blob' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: `dsr_${item._id}.json` }).click();
        URL.revokeObjectURL(url);
      } else {
        const { data: res } = await api.post(`/admin/dsr/${item._id}/run`);
        toast.success(`${res.records} registros anonimizados`);
      }
      load();
    } catch (err) { fail(err); }
  };
  const setRole = async (member, role) => {
    try { await api.put(`/admin/team/${member._id}`, { role }); toast.success('Equipe atualizada'); load(); } catch (err) { fail(err); }
  };

  return (
    <div className="space-y-4">
      <div className="stat-card" style={{ overflow: 'auto' }}>
        <p className="text-xs font-medium p-3">Chamados de suporte</p>
        <Table>
          <TableHeader><TableRow>{['Assunto', 'Aberto por', 'Situação', 'Atualizado', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.tickets.length === 0 && <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-6">Nenhum chamado aberto.</TableCell></TableRow>}
            {data.tickets.map(item => (
              <TableRow key={item._id}>
                <TableCell className="text-xs font-medium">{item.subject}</TableCell>
                <TableCell className="text-[10px]">{item.opened_by}</TableCell>
                <TableCell><Badge className={`text-[9px] ${item.status === 'closed' ? '' : item.status === 'answered' ? 'badge-info' : 'badge-warning'}`}>{data.ticket_status[item.status]}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{when(item.updated_at || item.created_at)}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => setTicket({ ...item, reply: '' })}>Responder</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="flex items-center justify-between p-3">
          <p className="text-xs font-medium">Comunicados</p>
          <Button size="sm" onClick={() => setAnnouncement({ title: '', text: '' })} data-testid="create-announcement"><Send size={13} className="mr-1" /> Enviar comunicado</Button>
        </div>
        <Table>
          <TableHeader><TableRow>{['Título', 'Workspaces', 'Enviado'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.announcements.length === 0 && <TableRow><TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-6">Nenhum comunicado enviado.</TableCell></TableRow>}
            {data.announcements.map(item => (
              <TableRow key={item._id}>
                <TableCell className="text-xs font-medium">{item.title}</TableCell>
                <TableCell className="text-xs">{item.workspaces}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{when(item.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="flex items-center justify-between p-3">
          <div>
            <p className="text-xs font-medium">Pedidos de titular (LGPD)</p>
            <p className="text-[10px] text-muted-foreground">Exportar ou apagar os dados de alguém. Prazo de 15 dias a partir do pedido.</p>
          </div>
          <Button size="sm" onClick={() => setDsr({ type: 'export', subject: '', note: '' })} data-testid="create-dsr"><Plus size={13} className="mr-1" /> Novo pedido</Button>
        </div>
        <Table>
          <TableHeader><TableRow>{['Titular', 'Pedido', 'Situação', 'Prazo', 'Resultado', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.dsr.length === 0 && <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-6">Nenhum pedido registrado.</TableCell></TableRow>}
            {data.dsr.map(item => (
              <TableRow key={item._id}>
                <TableCell className="text-xs font-medium">{item.subject}</TableCell>
                <TableCell className="text-[10px]">{data.dsr_types[item.type]}</TableCell>
                <TableCell><Badge className={`text-[9px] ${item.status === 'done' ? 'badge-success' : 'badge-warning'}`}>{data.dsr_status[item.status]}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{when(item.deadline)}</TableCell>
                <TableCell className="text-[10px]">{item.result || '—'}{item.records != null ? ` · ${item.records} registros` : ''}</TableCell>
                <TableCell className="text-right">{item.status === 'open' && <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={() => runDsr(item)}>Executar</Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <p className="text-xs font-medium p-3">Equipe global</p>
        <Table>
          <TableHeader><TableRow>{['Nome', 'E-mail', 'Desde', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {data.team.map(member => (
              <TableRow key={member._id}>
                <TableCell className="text-xs font-medium">{member.name || '—'}</TableCell>
                <TableCell className="text-[10px]">{member.email}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{when(member.created_at)}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" className="text-[10px] h-7 text-destructive" onClick={() => setRole(member, 'member')}>Tirar acesso</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!ticket} onOpenChange={o => !o && setTicket(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ticket?.subject}</DialogTitle></DialogHeader>
          {ticket && (
            <form onSubmit={reply} className="space-y-3">
              <div className="max-h-56 overflow-auto space-y-2">
                {(ticket.messages || []).map((m, i) => (
                  <div key={i} className={`text-xs p-2 rounded ${m.staff ? 'bg-primary/10' : 'bg-muted'}`}>
                    <p className="text-[9px] text-muted-foreground">{m.by} · {when(m.at)}</p>
                    <p>{m.text}</p>
                  </div>
                ))}
              </div>
              <div><Label className="text-xs">Resposta</Label><Textarea required rows={4} className="text-xs mt-1" value={ticket.reply} onChange={e => setTicket(t => ({ ...t, reply: e.target.value }))} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setTicket(null)}>Fechar</Button><Button type="submit">Responder</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!announcement} onOpenChange={o => !o && setAnnouncement(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Comunicado para todos os workspaces</DialogTitle></DialogHeader>
          {announcement && (
            <form onSubmit={send} className="space-y-3">
              <div><Label className="text-xs">Título</Label><Input required className="text-xs mt-1" value={announcement.title} onChange={e => setAnnouncement(a => ({ ...a, title: e.target.value }))} /></div>
              <div><Label className="text-xs">Texto</Label><Textarea required rows={4} className="text-xs mt-1" value={announcement.text} onChange={e => setAnnouncement(a => ({ ...a, text: e.target.value }))} /></div>
              <p className="text-[10px] text-muted-foreground">Vira notificação no painel de cada workspace.</p>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setAnnouncement(null)}>Cancelar</Button><Button type="submit">Enviar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!dsr} onOpenChange={o => !o && setDsr(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pedido do titular</DialogTitle></DialogHeader>
          {dsr && (
            <form onSubmit={createDsr} className="space-y-3">
              <div><Label className="text-xs">Tipo</Label>
                <Select value={dsr.type} onValueChange={v => setDsr(d => ({ ...d, type: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(data.dsr_types).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Titular (e-mail, telefone ou @usuário)</Label><Input required className="text-xs mt-1" value={dsr.subject} onChange={e => setDsr(d => ({ ...d, subject: e.target.value }))} /></div>
              <div><Label className="text-xs">Observação</Label><Input className="text-xs mt-1" value={dsr.note} onChange={e => setDsr(d => ({ ...d, note: e.target.value }))} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setDsr(null)}>Cancelar</Button><Button type="submit">Registrar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const adminStatusLabel = statusLabel;
