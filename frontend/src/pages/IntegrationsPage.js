import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Search, Radar, Settings, TestTube, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const PROVIDERS = [
  { id: 'tap', name: 'TAP', category: 'revenue', desc: 'Revenue provider — postback S2S' },
  { id: 'meta', name: 'Meta Ads', category: 'acquisition', desc: 'Leitura de mídia e CAPI' },
  { id: 'google', name: 'Google Ads', category: 'acquisition', desc: 'Campanhas e conversões' },
  { id: 'tiktok', name: 'TikTok', category: 'acquisition', desc: 'Ads e Events API' },
  { id: 'telegram', name: 'Telegram', category: 'messaging', desc: 'Bot, canais e atendimento' },
  { id: 'whatsapp', name: 'WhatsApp', category: 'messaging', desc: 'Canal de atendimento' },
  { id: 'zenvia_sms', name: 'Zenvia SMS', category: 'messaging', desc: 'Envio por segmentos' },
  { id: 'zenvia_voz', name: 'Zenvia Voz', category: 'messaging', desc: 'Texto para voz' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'infra', desc: 'Proxy e tracking' },
  { id: 'openai', name: 'OpenAI', category: 'ia', desc: 'Copiloto e processamento IA' },
];

const statusColors = { active: 'badge-success', configured: 'badge-info', connected: 'badge-info', available: '', error: 'badge-error', restricted: 'badge-warning' };

export default function IntegrationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({ provider: '', credentials: '{}', config: '{}' });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catFilter !== 'all') params.set('category', catFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const { data } = await api.get(`/integrations?${params}`);
      setItems(data.items);
    } catch (err) {
      toast.error('Erro ao carregar integrações');
    } finally {
      setLoading(false);
    }
  }, [search, catFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const provider = PROVIDERS.find(p => p.id === form.provider);
    if (!provider) return;
    try {
      let creds = {};
      let config = {};
      try { creds = JSON.parse(form.credentials); } catch {}
      try { config = JSON.parse(form.config); } catch {}
      await api.post('/integrations', {
        provider: provider.id,
        category: provider.category,
        name: provider.name,
        credentials: creds,
        config,
        capabilities: [],
      });
      toast.success('Integração criada');
      setShowCreate(false);
      setForm({ provider: '', credentials: '{}', config: '{}' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao criar');
    }
  };

  const handleTest = async (id) => {
    try {
      const { data } = await api.post(`/integrations/${id}/test`);
      toast.success(`Teste: ${data.status}`);
      load();
    } catch (err) {
      toast.error('Erro no teste');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover integração?')) return;
    try {
      await api.delete(`/integrations/${id}`);
      toast.success('Integração removida');
      load();
    } catch (err) {
      toast.error('Erro ao remover');
    }
  };

  return (
    <div data-testid="integrations-page">
      <div className="page-header">
        <div>
          <h1>Integrações<span className="accent">.</span></h1>
          <p className="page-description">Conecte provedores de receita, aquisição, mensageria e infraestrutura.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-integration-btn">
          <Plus size={14} className="mr-2" /> Nova integração
        </Button>
      </div>

      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '32px', height: '32px', fontSize: '11px' }} data-testid="integrations-search" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-category">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="revenue">Revenue</SelectItem>
            <SelectItem value="acquisition">Acquisition</SelectItem>
            <SelectItem value="messaging">Messaging</SelectItem>
            <SelectItem value="infra">Infra</SelectItem>
            <SelectItem value="ia">IA</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativa</SelectItem>
            <SelectItem value="configured">Configurada</SelectItem>
            <SelectItem value="available">Disponível</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Provedor</TableHead>
              <TableHead className="text-xs">Categoria</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Último teste</TableHead>
              <TableHead className="text-xs text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="empty-state">
                    <Radar size={32} />
                    <h3>Nenhuma integração</h3>
                    <p>Conecte seu primeiro provedor para começar a operar.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : items.map(item => (
              <TableRow key={item._id} data-testid={`integration-row-${item._id}`}>
                <TableCell className="text-xs font-medium">{item.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[9px]">{item.category}</Badge></TableCell>
                <TableCell><Badge className={`text-[9px] ${statusColors[item.status] || ''}`}>{item.status}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.last_test ? item.last_test.status : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowDetail(item)} data-testid={`config-${item._id}`}><Settings size={13} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleTest(item._id)} data-testid={`test-${item._id}`}><TestTube size={13} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(item._id)}><Trash2 size={13} /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-integration-dialog">
          <DialogHeader><DialogTitle>Nova integração</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Provedor</Label>
                <Select value={form.provider} onValueChange={v => setForm(f => ({ ...f, provider: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.name} — {p.desc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Credenciais (JSON)</Label>
                <Textarea className="text-xs mt-1 font-mono" rows={4} value={form.credentials} onChange={e => setForm(f => ({ ...f, credentials: e.target.value }))} placeholder='{"api_key": "...", "secret": "..."}' />
              </div>
              <div>
                <Label className="text-xs">Configuração (JSON)</Label>
                <Textarea className="text-xs mt-1 font-mono" rows={3} value={form.config} onChange={e => setForm(f => ({ ...f, config: e.target.value }))} placeholder='{"webhook_url": "..."}' />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button type="submit" disabled={!form.provider} data-testid="submit-integration">Criar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-lg" data-testid="integration-detail-dialog">
          <DialogHeader><DialogTitle>{showDetail?.name}</DialogTitle></DialogHeader>
          {showDetail && (
            <Tabs defaultValue="overview">
              <TabsList className="w-full">
                <TabsTrigger value="overview" className="text-xs flex-1">Visão</TabsTrigger>
                <TabsTrigger value="config" className="text-xs flex-1">Configuração</TabsTrigger>
                <TabsTrigger value="logs" className="text-xs flex-1">Logs</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="space-y-3 mt-3">
                <div className="text-xs"><span className="text-muted-foreground">Provedor:</span> {showDetail.provider}</div>
                <div className="text-xs"><span className="text-muted-foreground">Categoria:</span> {showDetail.category}</div>
                <div className="text-xs"><span className="text-muted-foreground">Status:</span> <Badge className={`text-[9px] ${statusColors[showDetail.status]}`}>{showDetail.status}</Badge></div>
                <div className="text-xs"><span className="text-muted-foreground">Criada:</span> {new Date(showDetail.created_at).toLocaleString('pt-BR')}</div>
              </TabsContent>
              <TabsContent value="config" className="mt-3">
                <div className="text-xs text-muted-foreground mb-2">Credenciais configuradas:</div>
                <pre className="text-[10px] bg-muted p-3 rounded-md overflow-auto">{JSON.stringify(showDetail.credentials_masked || showDetail.credentials, null, 2)}</pre>
              </TabsContent>
              <TabsContent value="logs" className="mt-3">
                <p className="text-xs text-muted-foreground">Logs de atividade aparecerão aqui conforme eventos forem processados.</p>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
