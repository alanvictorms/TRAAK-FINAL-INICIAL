import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
import { money, num } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { BarChart3, Headphones, SlidersHorizontal, ListFilter, Filter } from 'lucide-react';
import FunnelView from '@/components/analytics/FunnelView';
import { toast } from 'sonner';

const PERIODS = [['24h', 'Últimas 24h'], ['7d', '7 dias'], ['30d', '30 dias'], ['90d', '90 dias']];
const GRANULARITIES = [['hour', 'Hora'], ['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês']];
// Hora por 30/90 dias passa do limite de pontos do servidor.
const HOUR_OK = new Set(['24h', '7d']);

const MONEY_KPIS = new Set(['ftd_value', 'deposits_value', 'net_deposits', 'avg_ftd']);
const SERIES_METRICS = [
  ['clicks', 'Cliques', '#b7ff59'], ['bot_starts', 'StartBots', '#63d3b1'], ['channel_joins', 'Entradas no canal', '#4aa3d8'],
  ['registrations', 'Cadastros', '#8fe388'], ['ftds', 'FTDs', '#d8c46a'], ['deposits_value', 'Depósitos (R$)', '#3fbf8f'],
];
const SOURCE_LABELS = { meta: 'Meta Ads', tiktok: 'TikTok Ads', google: 'Google Ads', kwai: 'Kwai Ads', direct: 'Sem atribuição' };

const fmtKpi = (key, value, currency) => {
  if (value === null || value === undefined) return '—';
  if (MONEY_KPIS.has(key)) return money(value, currency);
  if (key === 'click_to_ftd') return `${value.toLocaleString('pt-BR')}%`;
  return num(value);
};

function Change({ value }) {
  if (value === null || value === undefined) return <div className="stat-change text-muted-foreground">sem base de comparação</div>;
  const cls = value === 0 ? 'text-muted-foreground' : value > 0 ? 'positive' : 'negative';
  return <div className={`stat-change ${cls}`}>{value > 0 ? '+' : ''}{value.toLocaleString('pt-BR')}% vs período anterior</div>;
}

function tickLabel(iso, granularity, tz) {
  const opts = granularity === 'hour'
    ? { hour: '2-digit', minute: '2-digit', timeZone: tz }
    : granularity === 'month'
      ? { month: 'short', year: '2-digit', timeZone: tz }
      : { day: '2-digit', month: '2-digit', timeZone: tz };
  return new Date(iso).toLocaleString('pt-BR', opts);
}

function MediaTab() {
  const [filters, setFilters] = useState({ period: '30d', granularity: 'day', source: 'all' });
  const [data, setData] = useState(null);
  const [series, setSeries] = useState(['clicks', 'ftds']);
  const [funnelView, setFunnelView] = useState('funnel');
  const [compare, setCompare] = useState(true);
  const [picking, setPicking] = useState(null);

  const load = useCallback(() => {
    const params = { period: filters.period, granularity: filters.granularity };
    if (filters.source !== 'all') params.source = filters.source;
    api.get('/analytics/overview', { params })
      .then(r => setData(r.data))
      .catch(err => toast.error(formatApiError(err.response?.data?.detail)));
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const setPeriod = (period) => setFilters(f => ({
    ...f, period, granularity: f.granularity === 'hour' && !HOUR_OK.has(period) ? 'day' : f.granularity,
  }));

  const chart = useMemo(() => (data?.series || []).map(p => ({
    t: p.t,
    ...Object.fromEntries(SERIES_METRICS.map(([key]) => [key, p[key] ?? 0])),
    ...Object.fromEntries(SERIES_METRICS.map(([key]) => [`prev_${key}`, p.previous?.[key] ?? 0])),
  })), [data]);

  const saveKpis = async () => {
    try {
      const { data: r } = await api.put('/analytics/preferences', { kpis: picking });
      setData(d => ({ ...d, selected_kpis: r.selected_kpis }));
      setPicking(null);
      toast.success('KPIs salvos');
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  if (!data) return <p className="text-xs text-muted-foreground mt-4">Carregando…</p>;

  const kpiByKey = Object.fromEntries(data.kpis.map(k => [k.key, k]));
  const sourceOptions = [...new Set([...data.by_source.map(s => s.source), ...(filters.source !== 'all' ? [filters.source] : [])])];
  const maxFunnel = Math.max(1, ...data.funnel.map(s => s.count));
  const onlyMoney = series.length > 0 && series.every(key => key === 'deposits_value');
  const fmtAxis = v => (onlyMoney ? money(v).replace(',00', '') : num(v));
  const fmtValue = (value, name) => (String(name).includes('Depósitos') ? money(value) : num(value));
  const toggleSeries = key => setSeries(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]));

  return (
    <div className="space-y-4">
      <div className="data-toolbar flex flex-wrap gap-2 items-center">
        <Select value={filters.period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 w-[130px] text-xs" data-testid="analytics-period"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODS.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.granularity} onValueChange={v => setFilters(f => ({ ...f, granularity: v }))}>
          <SelectTrigger className="h-8 w-[110px] text-xs" data-testid="analytics-granularity"><SelectValue /></SelectTrigger>
          <SelectContent>
            {GRANULARITIES.map(([v, l]) => (
              <SelectItem key={v} value={v} className="text-xs" disabled={v === 'hour' && !HOUR_OK.has(filters.period)}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.source} onValueChange={v => setFilters(f => ({ ...f, source: v }))}>
          <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="analytics-source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todas as fontes</SelectItem>
            {sourceOptions.map(s => <SelectItem key={s} value={s} className="text-xs">{SOURCE_LABELS[s] || s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8 text-xs ml-auto" onClick={() => setPicking(data.selected_kpis)} data-testid="customize-kpis">
          <SlidersHorizontal size={13} className="mr-1.5" /> Personalizar KPIs
        </Button>
      </div>

      <div className="stats-grid">
        {data.selected_kpis.map(key => kpiByKey[key] && (
          <div key={key} className="stat-card" data-testid={`kpi-${key}`}>
            <div className="stat-label">{kpiByKey[key].label}</div>
            <div className="stat-value">{fmtKpi(key, kpiByKey[key].value, data.currency)}</div>
            <Change value={kpiByKey[key].change} />
          </div>
        ))}
      </div>

      <div className="stat-card">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-sm font-medium">Evolução</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Métricas do gráfico">
            {SERIES_METRICS.map(([key, label, color]) => (
              <button key={key} type="button" onClick={() => toggleSeries(key)} data-testid={`series-${key}`}
                className={`series-chip ${series.includes(key) ? 'is-on' : ''}`} style={series.includes(key) ? { '--chip': color } : undefined}>
                <span style={{ background: color }} /> {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
            <Switch checked={compare} onCheckedChange={setCompare} className="scale-75" /> Comparar com período anterior
          </label>
        </div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tickFormatter={v => tickLabel(v, data.granularity, data.timezone)}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" minTickGap={16} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" width={56}
                tickFormatter={fmtAxis} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                labelFormatter={v => tickLabel(v, data.granularity, data.timezone)}
                formatter={fmtValue}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {SERIES_METRICS.filter(([key]) => series.includes(key)).map(([key, label, color]) => (
                <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={2} dot={false} />
              ))}
              {compare && SERIES_METRICS.filter(([key]) => series.includes(key)).map(([key, label, color]) => (
                <Line key={`prev_${key}`} type="monotone" dataKey={`prev_${key}`} name={`${label} (anterior)`} stroke={color}
                  strokeWidth={1.2} strokeDasharray="4 4" dot={false} opacity={0.55} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stat-card" data-testid="funnel">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">Funil</span>
          <div className="view-switch">
            <button type="button" className={funnelView === 'funnel' ? 'is-on' : ''} onClick={() => setFunnelView('funnel')} data-testid="funnel-view-funnel">
              <Filter size={11} /> Funil
            </button>
            <button type="button" className={funnelView === 'list' ? 'is-on' : ''} onClick={() => setFunnelView('list')} data-testid="funnel-view-list">
              <ListFilter size={11} /> Lista
            </button>
          </div>
        </div>
        {funnelView === 'funnel' && <FunnelView steps={data.funnel} compare={compare} />}
        <div className="space-y-2" hidden={funnelView !== 'list'}>
          {data.funnel.map(step => (
            <div key={step.key} className="grid items-center gap-3" style={{ gridTemplateColumns: 'minmax(90px, 120px) 1fr minmax(120px, 190px)' }}>
              <span className="text-xs">{step.label}</span>
              <div className="h-6 rounded bg-muted overflow-hidden">
                <div className="h-full rounded" style={{ width: `${(step.count / maxFunnel) * 100}%`, minWidth: step.count ? 2 : 0, background: 'hsl(var(--chart-1))' }} />
              </div>
              <div className="text-xs text-right tabular-nums">
                <span className="font-medium">{num(step.count)}</span>
                {step.step_rate !== null && <span className="text-muted-foreground"> · {step.step_rate.toLocaleString('pt-BR')}% do degrau</span>}
                {compare && <span className="block text-[10px] text-muted-foreground">antes: {num(step.previous)}</span>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          StartBot e entrada no canal vêm do bot do Telegram. Entrada no canal exige o bot como administrador do canal.
        </p>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="text-sm font-medium mb-2">Por fonte</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Fonte</TableHead>
            <TableHead className="text-xs text-right">Cliques</TableHead>
            <TableHead className="text-xs text-right">StartBots</TableHead>
            <TableHead className="text-xs text-right">Cadastros</TableHead>
            <TableHead className="text-xs text-right">FTDs</TableHead>
            <TableHead className="text-xs text-right">Clique → FTD</TableHead>
            <TableHead className="text-xs text-right">Depósitos</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {data.by_source.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><BarChart3 size={28} /><h3>Sem dados no período</h3><p>Os números aparecem conforme cliques e eventos chegam ao Signal Ledger.</p></div></TableCell></TableRow>
            ) : data.by_source.map(r => (
              <TableRow key={r.source}>
                <TableCell className="text-xs font-medium">{SOURCE_LABELS[r.source] || r.source}</TableCell>
                <TableCell className="text-xs text-right">{num(r.clicks)}</TableCell>
                <TableCell className="text-xs text-right">{num(r.bot_starts)}</TableCell>
                <TableCell className="text-xs text-right">{num(r.registrations)}</TableCell>
                <TableCell className="text-xs text-right">{num(r.ftds)}</TableCell>
                <TableCell className="text-xs text-right">{r.click_to_ftd === null ? '—' : `${r.click_to_ftd.toLocaleString('pt-BR')}%`}</TableCell>
                <TableCell className="text-xs text-right">{money(r.deposits_value, data.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-[10px] text-muted-foreground mt-2">
          Investimento total em campanhas: {money(data.spend_total, data.currency)} (acumulado — o gasto ainda não é registrado por dia).
        </p>
      </div>

      <Dialog open={picking !== null} onOpenChange={o => { if (!o) setPicking(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>KPIs em destaque</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Escolha de 1 a 8. A escolha vale só para você.</p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {data.kpis.map(k => {
              const checked = (picking || []).includes(k.key);
              return (
                <label key={k.key} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={checked} disabled={!checked && (picking || []).length >= 8}
                    onCheckedChange={v => setPicking(p => (v ? [...p, k.key] : p.filter(x => x !== k.key)))} />
                  {k.label}
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicking(null)}>Cancelar</Button>
            <Button onClick={saveKpis} disabled={!picking?.length} data-testid="save-kpis">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const minutes = (m) => {
  if (m === null || m === undefined) return '—';
  if (m < 60) return `${m.toLocaleString('pt-BR')} min`;
  return `${(m / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
};

function AttendanceTab() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/analytics/atendimento', { params: { period } })
      .then(r => setData(r.data))
      .catch(err => toast.error(formatApiError(err.response?.data?.detail)));
  }, [period]);

  if (!data) return <p className="text-xs text-muted-foreground mt-4">Carregando…</p>;
  const maxReason = Math.max(1, ...data.close_reasons.map(r => r.count));

  return (
    <div className="space-y-4">
      <div className="data-toolbar">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODS.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
        </Select>
        {data.truncated && <Badge variant="outline" className="text-[9px] ml-2">amostra limitada a 5.000 conversas</Badge>}
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">Na fila agora</div><div className="stat-value">{num(data.queue)}</div></div>
        <div className="stat-card"><div className="stat-label">Em atendimento agora</div><div className="stat-value">{num(data.active)}</div></div>
        <div className="stat-card"><div className="stat-label">Conversas no período</div><div className="stat-value">{num(data.total)}</div></div>
        <div className="stat-card">
          <div className="stat-label">1ª resposta (média)</div>
          <div className="stat-value">{minutes(data.first_response.avg)}</div>
          <div className="stat-change text-muted-foreground">mediana {minutes(data.first_response.median)}</div>
        </div>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <div className="text-sm font-medium mb-2">Por atendente</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Atendente</TableHead>
            <TableHead className="text-xs text-right">Conversas</TableHead>
            <TableHead className="text-xs text-right">Encerradas</TableHead>
            <TableHead className="text-xs text-right">Taxa</TableHead>
            <TableHead className="text-xs text-right">1ª resposta (média)</TableHead>
            <TableHead className="text-xs text-right">1ª resposta (mediana)</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {data.by_agent.length === 0 ? (
              <TableRow><TableCell colSpan={6}><div className="empty-state"><Headphones size={28} /><h3>Sem conversas no período</h3></div></TableCell></TableRow>
            ) : data.by_agent.map(a => (
              <TableRow key={a.agent_id || 'none'}>
                <TableCell className="text-xs font-medium">{a.name}</TableCell>
                <TableCell className="text-xs text-right">{num(a.conversations)}</TableCell>
                <TableCell className="text-xs text-right">{num(a.resolved)}</TableCell>
                <TableCell className="text-xs text-right">{a.resolution_rate === null ? '—' : `${a.resolution_rate.toLocaleString('pt-BR')}%`}</TableCell>
                <TableCell className="text-xs text-right">{minutes(a.first_response.avg)}</TableCell>
                <TableCell className="text-xs text-right">{minutes(a.first_response.median)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="stat-card">
          <div className="text-sm font-medium mb-3">Motivos de encerramento</div>
          {data.close_reasons.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma conversa encerrada no período.</p> : (
            <div className="space-y-2">
              {data.close_reasons.map(r => (
                <div key={r.key} className="grid items-center gap-2" style={{ gridTemplateColumns: '120px 1fr 40px' }}>
                  <span className="text-xs">{r.label}</span>
                  <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full" style={{ width: `${(r.count / maxReason) * 100}%`, background: 'hsl(var(--chart-2))' }} /></div>
                  <span className="text-xs text-right tabular-nums">{num(r.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="text-sm font-medium mb-3">Etiquetas mais usadas</div>
          {data.tags.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma etiqueta nas conversas do período.</p> : (
            <div className="flex flex-wrap gap-1.5">
              {data.tags.map(t => <Badge key={t.tag} variant="outline" className="text-[10px]">{t.tag} · {t.count}</Badge>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage({ tab = 'media' }) {
  const navigate = useNavigate();
  return (
    <div data-testid="analytics-page">
      <div className="page-header">
        <div>
          <h1>Analytics<span className="accent">.</span></h1>
          <p className="page-description">Aquisição, conversão e atendimento por período, com comparação ao período anterior.</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={v => navigate(v === 'media' ? '/analytics' : '/analytics/atendimento')}>
        <TabsList>
          <TabsTrigger value="media" className="text-xs gap-1.5"><BarChart3 size={12} /> Mídia</TabsTrigger>
          <TabsTrigger value="atendimento" className="text-xs gap-1.5"><Headphones size={12} /> Atendimento</TabsTrigger>
        </TabsList>
        <TabsContent value="media" className="mt-4">{tab === 'media' && <MediaTab />}</TabsContent>
        <TabsContent value="atendimento" className="mt-4">{tab === 'atendimento' && <AttendanceTab />}</TabsContent>
      </Tabs>
    </div>
  );
}
