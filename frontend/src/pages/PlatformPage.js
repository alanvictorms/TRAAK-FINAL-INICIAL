import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Building2, CreditCard, Bot, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PlatformPage() {
  const location = useLocation();
  const getTab = () => {
    if (location.pathname.includes('/tenants')) return 'tenants';
    if (location.pathname.includes('/plans')) return 'plans';
    if (location.pathname.includes('/ai')) return 'ai';
    return 'overview';
  };
  const [tab, setTab] = useState(getTab());
  const [overview, setOverview] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [aiProviders, setAiProviders] = useState([]);
  const [showCreateProvider, setShowCreateProvider] = useState(false);
  const [providerForm, setProviderForm] = useState({ name: '', provider: 'openai', model: 'gpt-5.4-mini', api_key: '', config: '{}' });

  useEffect(() => { setTab(getTab()); }, [location.pathname]);

  useEffect(() => {
    const load = async () => {
      try {
        if (tab === 'overview') { const { data } = await api.get('/platform'); setOverview(data); }
        if (tab === 'tenants') { const { data } = await api.get('/platform/tenants'); setTenants(data.items); }
        if (tab === 'plans') { const { data } = await api.get('/platform/plans'); setPlans(data.items); }
        if (tab === 'ai') { const { data } = await api.get('/platform/ai'); setAiProviders(data.items); }
      } catch (err) {
        if (err.response?.status === 403) toast.error('Acesso negado — apenas administradores da plataforma.');
        else toast.error('Erro ao carregar dados');
      }
    };
    load();
  }, [tab]);

  const handleCreateProvider = async (e) => {
    e.preventDefault();
    try {
      let config = {};
      try { config = JSON.parse(providerForm.config); } catch {}
      await api.post('/platform/ai', { ...providerForm, config });
      toast.success('Provedor IA criado');
      setShowCreateProvider(false);
      setProviderForm({ name: '', provider: 'openai', model: 'gpt-5.4-mini', api_key: '', config: '{}' });
      const { data } = await api.get('/platform/ai');
      setAiProviders(data.items);
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const deleteProvider = async (id) => {
    if (!window.confirm('Remover provedor IA?')) return;
    try {
      await api.delete(`/platform/ai/${id}`);
      toast.success('Removido');
      const { data } = await api.get('/platform/ai');
      setAiProviders(data.items);
    } catch { toast.error('Erro'); }
  };

  return (
    <div data-testid="platform-page">
      <div className="page-header">
        <div>
          <h1>Plataforma<span className="accent">.</span></h1>
          <p className="page-description">Administração global — tenants, planos e provedores IA.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview" className="text-xs gap-1.5"><Building2 size={12} /> Visão geral</TabsTrigger>
          <TabsTrigger value="tenants" className="text-xs gap-1.5"><Building2 size={12} /> Tenants</TabsTrigger>
          <TabsTrigger value="plans" className="text-xs gap-1.5"><CreditCard size={12} /> Planos</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs gap-1.5"><Bot size={12} /> Provedores IA</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {overview && (
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">TENANTS</div><div className="stat-value">{overview.tenants}</div></div>
              <div className="stat-card"><div className="stat-label">USUÁRIOS</div><div className="stat-value">{overview.users}</div></div>
              <div className="stat-card"><div className="stat-label">EVENTOS</div><div className="stat-value">{overview.events}</div></div>
              <div className="stat-card"><div className="stat-label">PROVEDORES IA</div><div className="stat-value">{overview.ai_providers}</div></div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tenants" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Nome</TableHead>
                <TableHead className="text-xs">Slug</TableHead>
                <TableHead className="text-xs">Plano</TableHead>
                <TableHead className="text-xs">Criado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {tenants.map(t => (
                  <TableRow key={t._id}>
                    <TableCell className="text-xs font-medium">{t.name}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{t.slug}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{t.plan || 'starter'}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleDateString('pt-BR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <div className="stat-card p-4">
            <p className="text-xs text-muted-foreground">Planos são configuráveis. Preços e limites do protótipo são exemplos demonstrativos (D10).</p>
            {plans.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-4">Nenhum plano cadastrado.</p>
            ) : plans.map(p => (
              <div key={p._id} className="mt-3 p-3 rounded-md bg-muted">
                <div className="text-xs font-medium">{p.name}</div>
                <div className="text-[10px] text-muted-foreground">{p.currency} {p.price}/mês</div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <Button size="sm" onClick={() => setShowCreateProvider(true)} data-testid="create-ai-provider-btn"><Plus size={14} className="mr-1" /> Novo provedor</Button>
          </div>
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Nome</TableHead>
                <TableHead className="text-xs">Provedor</TableHead>
                <TableHead className="text-xs">Modelo</TableHead>
                <TableHead className="text-xs">Chave</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {aiProviders.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-8">Nenhum provedor configurado. O Copiloto usará a chave padrão do ambiente.</TableCell></TableRow>
                ) : aiProviders.map(p => (
                  <TableRow key={p._id}>
                    <TableCell className="text-xs font-medium">{p.name}</TableCell>
                    <TableCell className="text-xs">{p.provider}</TableCell>
                    <TableCell className="text-[10px] font-mono">{p.model}</TableCell>
                    <TableCell className="text-[10px] font-mono text-muted-foreground">{p.api_key_masked}</TableCell>
                    <TableCell><Badge className={`text-[9px] ${p.status === 'active' ? 'badge-success' : 'badge-error'}`}>{p.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteProvider(p._id)}><Trash2 size={13} /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateProvider} onOpenChange={setShowCreateProvider}>
        <DialogContent data-testid="create-ai-provider-dialog">
          <DialogHeader><DialogTitle>Novo provedor de IA</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateProvider} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={providerForm.name} onChange={e => setProviderForm(f => ({ ...f, name: e.target.value }))} required placeholder="Principal, Backup..." /></div>
            <div><Label className="text-xs">Provedor</Label>
              <Select value={providerForm.provider} onValueChange={v => setProviderForm(f => ({ ...f, provider: v }))}>
                <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai" className="text-xs">OpenAI</SelectItem>
                  <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                  <SelectItem value="gemini" className="text-xs">Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Modelo</Label><Input className="text-xs mt-1" value={providerForm.model} onChange={e => setProviderForm(f => ({ ...f, model: e.target.value }))} placeholder="gpt-5.4-mini" /></div>
            <div><Label className="text-xs">Chave de API</Label><Input className="text-xs mt-1" type="password" value={providerForm.api_key} onChange={e => setProviderForm(f => ({ ...f, api_key: e.target.value }))} required placeholder="sk-..." /></div>
            <div><Label className="text-xs">Configuração (JSON)</Label><Textarea className="text-xs mt-1 font-mono" rows={2} value={providerForm.config} onChange={e => setProviderForm(f => ({ ...f, config: e.target.value }))} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateProvider(false)}>Cancelar</Button>
              <Button type="submit" data-testid="submit-ai-provider">Criar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
