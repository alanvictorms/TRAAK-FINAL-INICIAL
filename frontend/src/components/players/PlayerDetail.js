import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
import { money, num } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ArrowLeft, Send, Check, Circle } from 'lucide-react';
import { toast } from 'sonner';

const when = (v) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
const SOURCE_LABELS = { meta: 'Meta Ads', tiktok: 'TikTok Ads', google: 'Google Ads', kwai: 'Kwai Ads' };
const METHOD = { last_click: 'último clique', deep_link: 'deep link do bot' };

function Field({ label, children }) {
  return (
    <div className="text-xs">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-all">{children ?? '—'}</div>
    </div>
  );
}

export default function PlayerDetail({ id }) {
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [composer, setComposer] = useState(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    api.get(`/players/${id}`).then(r => setP(r.data)).catch(err => {
      toast.error(formatApiError(err.response?.data?.detail));
      navigate('/players', { replace: true });
    });
  }, [id, navigate]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setSending(true);
    try {
      const { data } = await api.post(`/players/${id}/message`, composer);
      toast.success('Mensagem enviada', { action: { label: 'Abrir conversa', onClick: () => navigate(`/inbox/${data.conversation_id}`) } });
      setComposer(null);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSending(false);
    }
  };

  if (!p) return <p className="text-xs text-muted-foreground">Carregando…</p>;

  const acq = p.acquisition || {};
  const attr = acq.attribution || {};
  const click = acq.click?.metadata || {};
  const reached = p.journey.filter(s => s.at).length;

  return (
    <div data-testid="player-detail">
      <div className="page-header">
        <div className="min-w-0">
          <Link to="/players" className="text-[10px] text-muted-foreground inline-flex items-center gap-1 mb-1"><ArrowLeft size={11} /> Players</Link>
          <h1 className="truncate">{p.name || p._id.slice(-8)}<span className="accent">.</span></h1>
          <p className="page-description">
            {attr.source ? `Veio de ${SOURCE_LABELS[attr.source] || attr.source}` : 'Sem atribuição'} · entrou via {p.origin || '—'} · {when(p.created_at)}
          </p>
        </div>
        <Button size="sm" disabled={!p.channels.length} data-testid="message-player"
          title={p.channels.length ? undefined : 'O player ainda não falou com nenhum canal conectado'}
          onClick={() => setComposer({ integration_id: p.channels[0].integration_id, content: '' })}>
          <Send size={13} className="mr-1.5" /> Enviar mensagem
        </Button>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Depósitos</div><div className="stat-value">{money(p.total_deposits || 0)}</div></div>
        <div className="stat-card"><div className="stat-label">Saques</div><div className="stat-value">{money(p.total_withdrawals || 0)}</div></div>
        <div className="stat-card"><div className="stat-label">FTD</div><div className="stat-value">{p.has_ftd ? money(p.ftd_value) : '—'}</div></div>
        <div className="stat-card"><div className="stat-label">Funil</div><div className="stat-value">{reached}/{p.journey.length}</div></div>
      </div>

      <Tabs defaultValue="funnel">
        <TabsList>
          <TabsTrigger value="funnel" className="text-xs">Funil</TabsTrigger>
          <TabsTrigger value="acquisition" className="text-xs">Aquisição</TabsTrigger>
          <TabsTrigger value="provider" className="text-xs">Provider</TabsTrigger>
          <TabsTrigger value="conversations" className="text-xs">Conversas</TabsTrigger>
          <TabsTrigger value="events" className="text-xs">Eventos</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="mt-4">
          <ol className="stat-card space-y-3" data-testid="player-journey">
            {p.journey.map((s, i) => {
              const prev = p.journey[i - 1];
              const gap = s.at && prev?.at ? Math.round((new Date(s.at) - new Date(prev.at)) / 60000) : null;
              return (
                <li key={s.key} className="flex items-center gap-3">
                  {s.at ? <Check size={14} className="text-primary shrink-0" /> : <Circle size={14} className="text-muted-foreground shrink-0" />}
                  <span className={`text-xs w-32 ${s.at ? '' : 'text-muted-foreground'}`}>{s.label}</span>
                  <span className="text-xs text-muted-foreground">{when(s.at)}</span>
                  {gap !== null && <span className="text-[10px] text-muted-foreground ml-auto">+{gap < 60 ? `${gap} min` : `${Math.round(gap / 60)} h`}</span>}
                </li>
              );
            })}
          </ol>
        </TabsContent>

        <TabsContent value="acquisition" className="mt-4">
          <div className="stat-card grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Fonte">{attr.source ? (SOURCE_LABELS[attr.source] || attr.source) : null}</Field>
            <Field label="Método">{METHOD[attr.method] || attr.method}</Field>
            <Field label="click_id"><span className="font-mono">{attr.click_id}</span></Field>
            <Field label="Link">{acq.link ? <Link className="underline" to={`/tracking/${acq.link._id}`}>{acq.link.name} (/{acq.link.slug})</Link> : null}</Field>
            <Field label="Campanha">{acq.campaign ? <Link className="underline" to={`/media/${acq.campaign._id}`}>{acq.campaign.name}</Link> : null}</Field>
            <Field label="Clique em">{acq.click ? when(acq.click.created_at) : null}</Field>
            <Field label="utm_campaign">{click.utm_campaign}</Field>
            <Field label="utm_content">{click.utm_content}</Field>
            <Field label="Dispositivo / país">{click.device ? `${click.device}${click.country ? ` · ${click.country}` : ''}` : null}</Field>
            <Field label="Variante / regra">{click.rule ? `regra: ${click.rule}` : click.variant}</Field>
            <Field label="Parâmetros da mídia">
              {click.query && Object.keys(click.query).length
                ? <span className="font-mono text-[10px]">{Object.entries(click.query).map(([k, v]) => `${k}=${v}`).join(' ')}</span>
                : null}
            </Field>
            <Field label="Referer">{click.referer}</Field>
          </div>
          {!p.acquisition?.attribution && (
            <p className="text-xs text-muted-foreground mt-3">
              Este player não chegou por um link rastreado. A atribuição acontece quando ele clica num link e inicia o bot pelo /start.
            </p>
          )}
        </TabsContent>

        <TabsContent value="provider" className="mt-4 space-y-4">
          <div className="stat-card grid gap-4 sm:grid-cols-3">
            <Field label="customer_id (TAP)"><span className="font-mono">{p.provider.customer_id}</span></Field>
            <Field label="Cadastro na casa">{p.provider.registered_at ? when(p.provider.registered_at) : null}</Field>
            <Field label="Líquido">{money((p.total_deposits || 0) - (p.total_withdrawals || 0))}</Field>
          </div>
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Quando</TableHead>
                <TableHead className="text-xs">Evento</TableHead>
                <TableHead className="text-xs">Transação</TableHead>
                <TableHead className="text-xs text-right">Valor</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {p.provider.events.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-6">Nenhum postback da casa para este player.</TableCell></TableRow>
                ) : p.provider.events.map(e => (
                  <TableRow key={e._id}>
                    <TableCell className="text-[10px]">{when(e.created_at)}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[9px] ${e.type === 'ftd' ? 'badge-success' : ''}`}>{e.type}</Badge></TableCell>
                    <TableCell className="text-[10px] font-mono">{e.external_id}</TableCell>
                    <TableCell className="text-xs text-right">{e.value === null || e.value === undefined ? '—' : money(e.value, e.currency || 'BRL')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="conversations" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Canal</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Última mensagem</TableHead>
                <TableHead className="text-xs">Atualizada</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {p.conversations.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-6">Sem conversas.</TableCell></TableRow>
                ) : p.conversations.map(c => (
                  <TableRow key={c._id} className="cursor-pointer" onClick={() => navigate(`/inbox/${c._id}`)}>
                    <TableCell className="text-xs capitalize">{c.integration_name || c.channel}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{c.status}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground max-w-[260px] truncate">{c.last_message || '—'}</TableCell>
                    <TableCell className="text-[10px]">{when(c.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Quando</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Fonte</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Valor</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {p.events.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-6">Sem eventos.</TableCell></TableRow>
                ) : p.events.map(e => (
                  <TableRow key={e._id} className="cursor-pointer" onClick={() => navigate(`/ledger/${e._id}`)}>
                    <TableCell className="text-[10px]">{when(e.created_at)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{e.type}</Badge></TableCell>
                    <TableCell className="text-xs">{e.source || '—'}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{e.status}</TableCell>
                    <TableCell className="text-xs text-right">{e.value === null || e.value === undefined ? '—' : money(e.value, e.currency || 'BRL')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-[10px] text-muted-foreground mt-2">Últimos {num(p.events.length)} eventos.</p>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!composer} onOpenChange={o => { if (!o) setComposer(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mensagem para {p.name}</DialogTitle></DialogHeader>
          {composer && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Canal</Label>
                <Select value={composer.integration_id} onValueChange={v => setComposer(c => ({ ...c, integration_id: v }))}>
                  <SelectTrigger className="text-xs mt-1" data-testid="message-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {p.channels.map(ch => (
                      <SelectItem key={ch.integration_id} value={ch.integration_id} className="text-xs">{ch.name} · {ch.provider}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Mensagem</Label>
                <Textarea className="text-xs mt-1" rows={4} value={composer.content} data-testid="message-content"
                  onChange={e => setComposer(c => ({ ...c, content: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposer(null)}>Cancelar</Button>
            <Button onClick={send} disabled={sending || !composer?.content.trim()} data-testid="send-player-message">
              {sending ? 'Enviando…' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
