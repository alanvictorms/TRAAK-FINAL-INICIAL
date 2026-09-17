import { useState, useEffect, useCallback } from 'react';
import api, { formatApiError } from '@/lib/api';
import { num } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Send, Plus, Trash2, Plane, BarChart3, XCircle, Search } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = {
  draft: ['Rascunho', ''], scheduled: ['Agendado', 'badge-warning'], queued: ['Na fila', 'badge-info'],
  sending: ['Enviando', 'badge-info'], sent: ['Enviado', 'badge-success'], cancelled: ['Cancelado', ''], failed: ['Falhou', 'badge-error'],
  awaiting_approval: ['Aguardando aprovação', 'badge-warning'],
};
const EMPTY = { name: '', channel: '', segment_id: 'all', variants: [{ name: 'A', text: '', weight: 100 }], scheduled_at: '' };
const err = e => toast.error(formatApiError(e.response?.data?.detail));

function DispatchesTab({ channels, segments, templates }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [report, setReport] = useState(null);

  const load = useCallback(() => api.get('/disparos').then(r => setItems(r.data.items)).catch(err), []);
  useEffect(() => {
    load();
    // Disparo em envio muda sozinho: acompanha enquanto houver algum ativo.
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const setVariant = (i, k, v) => setForm(f => ({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));

  const create = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/disparos', {
        name: form.name, channel: form.channel,
        segment_id: form.segment_id === 'all' ? null : form.segment_id,
        content: { variants: form.variants.map(v => ({ ...v, weight: Number(v.weight) || 0 })) },
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      });
      setForm(null);
      toast.success('Disparo criado — confira o pré-voo antes de enviar');
      load();
      openPreflight(data);
    } catch (e2) { err(e2); }
  };

  const openPreflight = async (d) => {
    try { const { data } = await api.post(`/disparos/${d._id}/preflight`); setPreflight({ dispatch: d, ...data }); } catch (e) { err(e); }
  };
  const send = async () => {
    try {
      const { data } = await api.post(`/disparos/${preflight.dispatch._id}/send`);
      toast.success({ scheduled: 'Disparo agendado', awaiting_approval: 'Enviado para aprovação em Governança' }[data.status] || 'Disparo na fila de envio');
      setPreflight(null);
      load();
    } catch (e) { err(e); }
  };
  const cancel = async (d) => {
    if (!window.confirm('Cancelar o envio? Quem ainda não recebeu não receberá.')) return;
    try { const { data } = await api.post(`/disparos/${d._id}/cancel`); toast.success(`${data.detail} · ${data.not_sent} não enviados`); load(); } catch (e) { err(e); }
  };
  const remove = async (d) => {
    if (!window.confirm('Remover disparo?')) return;
    try { await api.delete(`/disparos/${d._id}`); toast.success('Removido'); load(); } catch (e) { err(e); }
  };
  const openReport = async (d) => {
    try { const { data } = await api.get(`/disparos/${d._id}/report`); setReport(data); } catch (e) { err(e); }
  };

  const channelName = id => channels.find(c => c._id === id)?.name || '—';
  const segmentName = id => (id ? segments.find(s => s._id === id)?.name || '—' : 'Todos os players');

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setForm({ ...EMPTY, channel: channels[0]?._id || '' })} disabled={!channels.length} data-testid="create-dispatch-btn"
          title={channels.length ? undefined : 'Conecte um Telegram ou WhatsApp em Integrações'}>
          <Plus size={14} className="mr-2" /> Novo disparo
        </Button>
      </div>
      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Nome</TableHead>
            <TableHead className="text-xs">Canal</TableHead>
            <TableHead className="text-xs">Público</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs text-right">Enviados</TableHead>
            <TableHead className="text-xs">Quando</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><Send size={32} /><h3>Nenhum disparo</h3><p>Crie um disparo para um segmento pelo Telegram ou WhatsApp.</p></div></TableCell></TableRow>
            ) : items.map(d => {
              const [label, cls] = STATUS[d.status] || [d.status, ''];
              const st = d.stats || {};
              return (
                <TableRow key={d._id} data-testid={`dispatch-${d._id}`}>
                  <TableCell className="text-xs font-medium">{d.name}</TableCell>
                  <TableCell className="text-xs">{channelName(d.channel)}</TableCell>
                  <TableCell className="text-xs">{segmentName(d.segment_id)}</TableCell>
                  <TableCell><Badge className={`text-[9px] ${cls}`}>{label}</Badge>{d.paused_reason && d.status === 'sending' && <p className="text-[9px] text-muted-foreground">{d.paused_reason}</p>}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{st.eligible ? `${num(st.sent || 0)}/${num(st.eligible)}` : '—'}{st.failed ? <span className="text-destructive"> · {num(st.failed)} falhas</span> : null}</TableCell>
                  <TableCell className="text-[10px] text-muted-foreground">{d.scheduled_at ? new Date(d.scheduled_at).toLocaleString('pt-BR') : 'Imediato'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {['draft', 'failed'].includes(d.status) && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Pré-voo e envio" title="Pré-voo e envio" onClick={() => openPreflight(d)}><Plane size={13} /></Button>}
                      {['scheduled', 'queued', 'sending'].includes(d.status) && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancelar" title="Cancelar" onClick={() => cancel(d)}><XCircle size={13} /></Button>}
                      {d.stats?.eligible > 0 && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Relatório" title="Relatório de entrega" onClick={() => openReport(d)}><BarChart3 size={13} /></Button>}
                      {!['queued', 'sending'].includes(d.status) && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Remover" onClick={() => remove(d)}><Trash2 size={13} /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="max-w-2xl" data-testid="create-dispatch-dialog">
          <DialogHeader><DialogTitle>Novo disparo</DialogTitle></DialogHeader>
          {form && (
            <form onSubmit={create} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
                <div><Label className="text-xs">Canal</Label>
                  <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v }))}>
                    <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent>{channels.map(c => <SelectItem key={c._id} value={c._id} className="text-xs">{c.name} · {c.provider}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Público</Label>
                  <Select value={form.segment_id} onValueChange={v => setForm(f => ({ ...f, segment_id: v }))}>
                    <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">Todos os players</SelectItem>
                      {segments.map(s => <SelectItem key={s._id} value={s._id} className="text-xs">{s.name} ({num(s.count)})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Agendar (vazio = enviar ao confirmar)</Label><Input type="datetime-local" className="text-xs mt-1" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} /></div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Mensagem {form.variants.length > 1 ? '(variantes A/B)' : ''}</Label>
                  <div className="flex gap-2">
                    {templates.length > 0 && (
                      <Select value="" onValueChange={id => { const t = templates.find(x => x._id === id); if (t) setVariant(0, 'text', t.text); }}>
                        <SelectTrigger className="h-7 text-[10px] w-[150px]"><SelectValue placeholder="Usar template" /></SelectTrigger>
                        <SelectContent>{templates.map(t => <SelectItem key={t._id} value={t._id} className="text-xs">{t.name}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {form.variants.length < 4 && (
                      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]"
                        onClick={() => setForm(f => ({ ...f, variants: [...f.variants, { name: String.fromCharCode(65 + f.variants.length), text: '', weight: 50 }] }))}>
                        + Variante
                      </Button>
                    )}
                  </div>
                </div>
                {form.variants.map((v, i) => (
                  <div key={i} className="grid gap-2" style={{ gridTemplateColumns: '48px 1fr 70px 28px' }}>
                    <Input className="text-xs h-8" value={v.name} onChange={e => setVariant(i, 'name', e.target.value)} aria-label="Nome da variante" />
                    <Textarea rows={2} className="text-xs" value={v.text} onChange={e => setVariant(i, 'text', e.target.value)} placeholder="Olá {primeiro_nome}!" required={i === 0} />
                    <Input type="number" min="0" className="text-xs h-8" value={v.weight} onChange={e => setVariant(i, 'weight', e.target.value)} aria-label="Peso" />
                    {form.variants.length > 1 && <Button type="button" variant="ghost" size="icon" className="h-8 w-7 text-destructive" aria-label="Remover variante" onClick={() => setForm(f => ({ ...f, variants: f.variants.filter((_, j) => j !== i) }))}><Trash2 size={12} /></Button>}
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">Use {'{nome}'} ou {'{primeiro_nome}'}. Quem respondeu PARE, SAIR ou STOP é suprimido automaticamente.</p>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" data-testid="submit-dispatch">Criar e ver pré-voo</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!preflight} onOpenChange={o => !o && setPreflight(null)}>
        <DialogContent data-testid="preflight-dialog">
          <DialogHeader><DialogTitle>Pré-voo · {preflight?.dispatch.name}</DialogTitle></DialogHeader>
          {preflight && (
            <div className="space-y-3">
              <div className="stats-grid" style={{ marginBottom: 0 }}>
                <div className="stat-card"><div className="stat-label">No público</div><div className="stat-value">{num(preflight.target)}</div></div>
                <div className="stat-card"><div className="stat-label">Vão receber</div><div className="stat-value">{num(preflight.eligible)}</div></div>
              </div>
              <p className="text-xs text-muted-foreground">
                Fora do envio: {num(preflight.skipped.sem_contato)} sem contato em {preflight.channel.provider} · {num(preflight.skipped.suprimido)} suprimidos.
              </p>
              {preflight.variants.length > 1 && (
                <p className="text-xs">{preflight.variants.map(v => `${v.name}: ~${num(v.expected)} (${v.share}%)`).join(' · ')}</p>
              )}
              {preflight.note && <p className="text-[10px] text-amber-300">{preflight.note}</p>}
              {preflight.sample.length > 0 && <p className="text-[10px] text-muted-foreground">Ex.: {preflight.sample.map(s => s.name).join(', ')}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreflight(null)}>Fechar</Button>
            <Button onClick={send} disabled={!preflight?.eligible} data-testid="confirm-send">
              {preflight?.dispatch.scheduled_at && new Date(preflight.dispatch.scheduled_at) > new Date() ? 'Agendar' : `Enviar para ${num(preflight?.eligible || 0)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!report} onOpenChange={o => !o && setReport(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Relatório · {report?.dispatch.name}</DialogTitle></DialogHeader>
          <DialogDescription className="text-xs">FTD conta quem recebeu e fez o primeiro depósito em até 7 dias.</DialogDescription>
          {report && (
            <>
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">Variante</TableHead><TableHead className="text-xs text-right">Enviados</TableHead>
                  <TableHead className="text-xs text-right">Falhas</TableHead><TableHead className="text-xs text-right">Na fila</TableHead>
                  <TableHead className="text-xs text-right">FTDs</TableHead><TableHead className="text-xs text-right">Conversão</TableHead>
                </TableRow></TableHeader>
                <TableBody>{report.by_variant.map(v => (
                  <TableRow key={v.variant}>
                    <TableCell className="text-xs">{v.variant}</TableCell>
                    <TableCell className="text-xs text-right">{num(v.sent || 0)}</TableCell>
                    <TableCell className="text-xs text-right">{num(v.failed || 0)}</TableCell>
                    <TableCell className="text-xs text-right">{num(v.queued || 0)}</TableCell>
                    <TableCell className="text-xs text-right">{num(v.ftds)}</TableCell>
                    <TableCell className="text-xs text-right">{v.conversion === null ? '—' : `${v.conversion}%`}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
              {report.failures.length > 0 && (
                <div className="max-h-40 overflow-auto">
                  <p className="text-xs font-medium mt-2 mb-1">Falhas</p>
                  {report.failures.map(f => <p key={f._id} className="text-[10px] text-muted-foreground">{f.player_name}: {f.error}</p>)}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TemplatesTab({ templates, reload }) {
  const [form, setForm] = useState({ name: '', text: '' });
  const create = async (e) => {
    e.preventDefault();
    try { await api.post('/disparos/templates', form); setForm({ name: '', text: '' }); toast.success('Template salvo'); reload(); } catch (e2) { err(e2); }
  };
  const remove = async (id) => {
    if (!window.confirm('Remover template?')) return;
    try { await api.delete(`/disparos/templates/${id}`); reload(); } catch (e) { err(e); }
  };
  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <form onSubmit={create} className="stat-card space-y-2">
        <div className="text-sm font-medium">Novo template</div>
        <Input className="text-xs" placeholder="Nome" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        <Textarea rows={5} className="text-xs" placeholder="Olá {primeiro_nome}…" value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} required />
        <Button size="sm" type="submit" data-testid="save-template">Salvar template</Button>
      </form>
      <div className="stat-card space-y-2">
        {templates.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum template.</p> : templates.map(t => (
          <div key={t._id} className="border-b border-border pb-2 last:border-0">
            <div className="flex items-center justify-between"><span className="text-xs font-medium">{t.name}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" aria-label="Remover template" onClick={() => remove(t._id)}><Trash2 size={12} /></Button></div>
            <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{t.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuppressionTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ contact: '', provider: 'telegram', reason: '' });
  const load = useCallback(() => {
    api.get('/disparos/suppressions', { params: search ? { contact: search } : {} })
      .then(r => { setItems(r.data.items); setTotal(r.data.total); }).catch(err);
  }, [search]);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try { await api.post('/disparos/suppressions', form); setForm(f => ({ ...f, contact: '', reason: '' })); toast.success('Contato suprimido'); load(); } catch (e2) { err(e2); }
  };
  const remove = async (id) => {
    if (!window.confirm('Voltar a enviar para este contato?')) return;
    try { await api.delete(`/disparos/suppressions/${id}`); load(); } catch (e) { err(e); }
  };
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="stat-card flex flex-wrap gap-2 items-end">
        <div><Label className="text-xs">Contato (ID do Telegram ou telefone)</Label><Input className="text-xs mt-1 w-56" value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} required /></div>
        <div><Label className="text-xs">Canal</Label>
          <Select value={form.provider} onValueChange={v => setForm(f => ({ ...f, provider: v }))}>
            <SelectTrigger className="text-xs mt-1 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="telegram" className="text-xs">Telegram</SelectItem><SelectItem value="whatsapp" className="text-xs">WhatsApp</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[160px]"><Label className="text-xs">Motivo</Label><Input className="text-xs mt-1" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
        <Button size="sm" type="submit" data-testid="add-suppression">Suprimir</Button>
      </form>
      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="flex items-center gap-2 mb-2">
          <Search size={13} className="text-muted-foreground" />
          <Input className="text-xs h-8 max-w-xs" placeholder="Consultar contato exato…" value={search} onChange={e => setSearch(e.target.value.trim())} />
          <Badge variant="outline" className="text-[9px] ml-auto">{num(total)} suprimidos</Badge>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead className="text-xs">Contato</TableHead><TableHead className="text-xs">Canal</TableHead><TableHead className="text-xs">Motivo</TableHead><TableHead className="text-xs">Desde</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-6">{search ? 'Contato não está suprimido.' : 'Nenhum contato suprimido.'}</TableCell></TableRow>
            ) : items.map(s => (
              <TableRow key={s._id}>
                <TableCell className="text-xs font-mono">{s.contact}</TableCell>
                <TableCell className="text-xs">{s.provider}</TableCell>
                <TableCell className="text-xs">{s.reason}</TableCell>
                <TableCell className="text-[10px]">{new Date(s.created_at).toLocaleString('pt-BR')}</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Remover da supressão" onClick={() => remove(s._id)}><Trash2 size={12} /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function DisparosPage() {
  const [channels, setChannels] = useState([]);
  const [segments, setSegments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const loadTemplates = useCallback(() => api.get('/disparos/templates').then(r => setTemplates(r.data.items)).catch(() => {}), []);
  useEffect(() => {
    api.get('/integrations', { params: { limit: 100 } })
      .then(r => setChannels(r.data.items.filter(i => ['telegram', 'whatsapp'].includes(i.provider)))).catch(() => {});
    api.get('/segments').then(r => setSegments(r.data.items)).catch(() => {});
    loadTemplates();
  }, [loadTemplates]);

  return (
    <div data-testid="disparos-page">
      <div className="page-header">
        <div><h1>Disparos<span className="accent">.</span></h1><p className="page-description">Mensagens em massa para segmentos, com pré-voo, variantes e relatório de entrega.</p></div>
      </div>
      <Tabs defaultValue="dispatches">
        <TabsList>
          <TabsTrigger value="dispatches" className="text-xs">Disparos</TabsTrigger>
          <TabsTrigger value="templates" className="text-xs">Templates</TabsTrigger>
          <TabsTrigger value="suppression" className="text-xs">Supressão</TabsTrigger>
        </TabsList>
        <TabsContent value="dispatches" className="mt-4"><DispatchesTab channels={channels} segments={segments} templates={templates} /></TabsContent>
        <TabsContent value="templates" className="mt-4"><TemplatesTab templates={templates} reload={loadTemplates} /></TabsContent>
        <TabsContent value="suppression" className="mt-4"><SuppressionTab /></TabsContent>
      </Tabs>
    </div>
  );
}
