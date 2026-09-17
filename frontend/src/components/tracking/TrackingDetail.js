import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
import { num } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ArrowLeft, Copy, Plus, Trash2, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL;
const SPLIT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)', 'var(--chart-3)', 'var(--chart-5)'];
const RULE_TYPES = [
  ['device', 'Dispositivo', 'mobile ou desktop'],
  ['country', 'País', 'códigos ISO, ex.: BR, PT (exige Cloudflare na frente)'],
  ['hour', 'Horário', 'faixas no fuso do workspace, ex.: 18-23, 22-2'],
];

const copy = (text, what) => { navigator.clipboard.writeText(text); toast.success(`${what} copiado`); };

function Breakdown({ title, rows }) {
  const total = rows.reduce((s, r) => s + r.clicks, 0) || 1;
  return (
    <div className="stat-card">
      <div className="text-sm font-medium mb-2">{title}</div>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">Sem cliques.</p> : rows.map(r => (
        <div key={r.key} className="flex justify-between text-xs py-0.5">
          <span className="truncate">{r.key}</span>
          <span className="tabular-nums text-muted-foreground">{num(r.clicks)} · {Math.round((r.clicks / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function TrackingDetail({ id }) {
  const [link, setLink] = useState(null);
  const [stats, setStats] = useState(null);
  const [variants, setVariants] = useState([]);
  const [rules, setRules] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: l }, { data: s }] = await Promise.all([api.get(`/tracking/${id}`), api.get(`/tracking/${id}/stats`)]);
      setLink(l);
      setStats(s);
      setVariants(l.ab_variants || []);
      setRules((l.rules || []).map(r => ({ ...r, valuesText: (r.values || []).join(', ') })));
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch, message) => {
    setSaving(true);
    try {
      const { data } = await api.put(`/tracking/${id}`, patch);
      setLink(data);
      toast.success(message);
      const { data: s } = await api.get(`/tracking/${id}/stats`);
      setStats(s);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  if (!link) return <p className="text-xs text-muted-foreground">Carregando…</p>;

  const totalWeight = variants.reduce((s, v) => s + (Number(v.weight) || 0), 0);
  const url = link.public_url;
  const snippet = `<a id="trak-link" href="${url}">Entrar</a>\n<script>(function(a){var q=location.search;if(q&&a)a.href+=(a.href.indexOf('?')<0?'?':'&')+q.slice(1);})(document.getElementById('trak-link'));</script>`;

  const setVariant = (i, field, value) => setVariants(vs => vs.map((v, j) => (j === i ? { ...v, [field]: value } : v)));
  const setRule = (i, field, value) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const moveRule = (i, dir) => setRules(rs => {
    const next = rs.slice();
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    return next;
  });

  const saveVariants = () => save({
    ab_variants: variants.map(v => ({ name: v.name, destination: v.destination, weight: Number(v.weight) || 0 })),
  }, 'Variantes salvas');
  const saveRules = () => save({
    rules: rules.map(r => ({
      type: r.type, destination: r.destination,
      values: r.valuesText.split(',').map(x => x.trim()).filter(Boolean),
    })),
  }, 'Regras salvas');

  return (
    <div data-testid="tracking-detail">
      <div className="page-header">
        <div className="min-w-0">
          <Link to="/tracking" className="text-[10px] text-muted-foreground inline-flex items-center gap-1 mb-1"><ArrowLeft size={11} /> Links</Link>
          <h1 className="truncate">{link.name}<span className="accent">.</span></h1>
          <p className="page-description font-mono">/{link.slug} → {link.destination}</p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={link.status === 'active'} disabled={saving} data-testid="link-status"
            onCheckedChange={v => save({ status: v ? 'active' : 'paused' }, v ? 'Link ativado' : 'Link pausado')} />
          {link.status === 'active' ? 'Ativo' : 'Pausado'}
        </label>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Cliques ({stats?.days} dias)</div><div className="stat-value">{num(stats?.clicks)}</div></div>
        <div className="stat-card"><div className="stat-label">FTDs atribuídos</div><div className="stat-value">{num(stats?.ftds)}</div></div>
        <div className="stat-card"><div className="stat-label">Cliques no total</div><div className="stat-value">{num(link.clicks)}</div></div>
        <div className="stat-card"><div className="stat-label">Origem</div><div className="stat-value text-base">{link.utm_source || '—'}</div></div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="text-xs">Visão geral</TabsTrigger>
          <TabsTrigger value="ab" className="text-xs">A/B</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs">Regras</TabsTrigger>
          <TabsTrigger value="share" className="text-xs">QR e snippet</TabsTrigger>
          <TabsTrigger value="history" className="text-xs">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="stat-card">
            <div className="text-sm font-medium mb-2">Cliques por dia</div>
            {stats?.by_day.length ? (
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={stats.by_day}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={d => d.slice(8, 10) + '/' + d.slice(5, 7)} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" />
                    <YAxis allowDecimals={false} width={36} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" />
                    <Tooltip contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', fontSize: 11 }} formatter={v => [num(v), 'Cliques']} />
                    <Bar dataKey="clicks" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-xs text-muted-foreground">Nenhum clique no período. Compartilhe a URL pública para começar.</p>}
            <p className="text-[10px] text-muted-foreground mt-2">Dias em UTC.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Breakdown title="Por variante" rows={stats?.by_variant || []} />
            <Breakdown title="Por dispositivo" rows={stats?.by_device || []} />
            <Breakdown title="Por país" rows={stats?.by_country || []} />
          </div>
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <div className="text-sm font-medium mb-2">Últimos cliques</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Quando</TableHead>
                <TableHead className="text-xs">click_id</TableHead>
                <TableHead className="text-xs">Dispositivo</TableHead>
                <TableHead className="text-xs">Variante / regra</TableHead>
                <TableHead className="text-xs">Lead</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(stats?.recent || []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-6">Sem cliques.</TableCell></TableRow>
                ) : stats.recent.map(c => (
                  <TableRow key={c._id}>
                    <TableCell className="text-[10px]">{new Date(c.created_at).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-[10px] font-mono">{c.external_id}</TableCell>
                    <TableCell className="text-[10px]">{c.metadata?.device}{c.metadata?.country ? ` · ${c.metadata.country}` : ''}</TableCell>
                    <TableCell className="text-[10px]">{c.metadata?.rule ? `regra: ${c.metadata.rule}` : c.metadata?.variant || 'destino padrão'}</TableCell>
                    <TableCell className="text-[10px]">{c.person_id ? <Link className="underline" to={`/players/${c.person_id}`}>ver player</Link> : <span className="text-muted-foreground">não identificado</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="ab" className="mt-4">
          <div className="stat-card space-y-3 max-w-3xl">
            <p className="text-xs text-muted-foreground">Cada clique sorteia um destino pelo peso. Sem variantes, vai para o destino padrão. Regras, quando casam, têm prioridade.</p>
            {totalWeight > 0 && (
              <div className="flex h-6 rounded overflow-hidden" data-testid="ab-split">
                {variants.map((v, i) => Number(v.weight) > 0 && (
                  <div key={i} className="flex items-center justify-center text-[10px] text-black font-medium"
                    style={{ width: `${(Number(v.weight) / totalWeight) * 100}%`, background: `hsl(${SPLIT_COLORS[i % SPLIT_COLORS.length]})` }}>
                    {Math.round((Number(v.weight) / totalWeight) * 100)}%
                  </div>
                ))}
              </div>
            )}
            {variants.map((v, i) => (
              <div key={i} className="grid gap-2 items-end" style={{ gridTemplateColumns: '1fr 2fr 80px 32px' }}>
                <div><Label className="text-[10px]">Nome</Label><Input className="text-xs h-8" value={v.name || ''} onChange={e => setVariant(i, 'name', e.target.value)} placeholder={`Variante ${String.fromCharCode(65 + i)}`} /></div>
                <div><Label className="text-[10px]">Destino</Label><Input className="text-xs h-8" type="url" value={v.destination || ''} onChange={e => setVariant(i, 'destination', e.target.value)} placeholder="https://…" /></div>
                <div><Label className="text-[10px]">Peso</Label><Input className="text-xs h-8" type="number" min="0" value={v.weight ?? ''} onChange={e => setVariant(i, 'weight', e.target.value)} /></div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Remover variante" onClick={() => setVariants(vs => vs.filter((_, j) => j !== i))}><Trash2 size={13} /></Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setVariants(vs => [...vs, { name: '', destination: link.destination, weight: 50 }])}><Plus size={12} className="mr-1" /> Variante</Button>
              <Button size="sm" className="text-xs ml-auto" onClick={saveVariants} disabled={saving} data-testid="save-variants">Salvar variantes</Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <div className="stat-card space-y-3 max-w-3xl">
            <p className="text-xs text-muted-foreground">Avaliadas de cima para baixo; a primeira que casar decide o destino.</p>
            {rules.map((r, i) => (
              <div key={i} className="grid gap-2 items-end" style={{ gridTemplateColumns: '130px 1fr 2fr 72px' }}>
                <div>
                  <Label className="text-[10px]">Tipo</Label>
                  <Select value={r.type} onValueChange={v => setRule(i, 'type', v)}>
                    <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{RULE_TYPES.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Valores</Label>
                  <Input className="text-xs h-8" value={r.valuesText} onChange={e => setRule(i, 'valuesText', e.target.value)}
                    placeholder={RULE_TYPES.find(t => t[0] === r.type)?.[2]} />
                </div>
                <div><Label className="text-[10px]">Destino</Label><Input className="text-xs h-8" type="url" value={r.destination || ''} onChange={e => setRule(i, 'destination', e.target.value)} placeholder="https://…" /></div>
                <div className="flex">
                  <Button variant="ghost" size="icon" className="h-8 w-6" aria-label="Subir" disabled={i === 0} onClick={() => moveRule(i, -1)}><ArrowUp size={12} /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-6" aria-label="Descer" disabled={i === rules.length - 1} onClick={() => moveRule(i, 1)}><ArrowDown size={12} /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-6 text-destructive" aria-label="Remover regra" onClick={() => setRules(rs => rs.filter((_, j) => j !== i))}><Trash2 size={12} /></Button>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">{RULE_TYPES.map(([, l, h]) => `${l}: ${h}`).join(' · ')}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setRules(rs => [...rs, { type: 'device', valuesText: 'mobile', destination: link.destination }])}><Plus size={12} className="mr-1" /> Regra</Button>
              <Button size="sm" className="text-xs ml-auto" onClick={saveRules} disabled={saving} data-testid="save-rules">Salvar regras</Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="share" className="mt-4">
          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
            <div className="stat-card flex flex-col items-center gap-2">
              <img src={`${API_URL}/api/tracking/${id}/qr.svg`} alt={`QR code de ${url}`} width={180} height={180} className="bg-white rounded" />
              <Button asChild variant="outline" size="sm" className="text-xs">
                <a href={`${API_URL}/api/tracking/${id}/qr.svg`} download={`${link.slug}.svg`}><Download size={12} className="mr-1" /> Baixar SVG</a>
              </Button>
            </div>
            <div className="space-y-4 min-w-0">
              <div className="stat-card">
                <Label className="text-xs">URL pública</Label>
                <div className="flex gap-2 mt-1">
                  <Input readOnly value={url || 'URL pública não configurada'} className="text-xs font-mono" />
                  <Button variant="outline" size="icon" aria-label="Copiar URL" disabled={!url} onClick={() => copy(url, 'Link')}><Copy size={13} /></Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Destino t.me recebe o click_id no parâmetro start. Em outros destinos, use {'{click_id}'} na URL onde a casa espera o identificador.
                </p>
              </div>
              <div className="stat-card">
                <Label className="text-xs">Snippet para presell</Label>
                <p className="text-[10px] text-muted-foreground mb-1">Repassa os parâmetros da página (fbclid, ttclid, UTMs) para o link.</p>
                <pre className="text-[10px] font-mono bg-muted rounded p-2 whitespace-pre-wrap break-all">{snippet}</pre>
                <Button variant="outline" size="sm" className="text-xs mt-2" onClick={() => copy(snippet, 'Snippet')}><Copy size={12} className="mr-1" /> Copiar snippet</Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Quando</TableHead>
                <TableHead className="text-xs">Ação</TableHead>
                <TableHead className="text-xs">Por</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(stats?.history || []).length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-6">Sem alterações registradas.</TableCell></TableRow>
                ) : stats.history.map(h => (
                  <TableRow key={h._id}>
                    <TableCell className="text-[10px]">{new Date(h.timestamp).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline" className="text-[9px] font-mono">{h.action}</Badge></TableCell>
                    <TableCell className="text-xs">{h.user_email}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
