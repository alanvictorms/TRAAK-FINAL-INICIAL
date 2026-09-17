import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Settings, UsersRound, Key, ClipboardList, Plus, Trash2, CreditCard, Bell } from 'lucide-react';
import BillingPanel from '@/components/settings/BillingPanel';
import NotificationsPanel from '@/components/settings/NotificationsPanel';
import { toast } from 'sonner';

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname.split('/')[2] || 'general';
  const setTab = (value) => navigate(`/settings/${value}`);
  const [ws, setWs] = useState(null);
  const [team, setTeam] = useState({ members: [], invites: [] });
  const [apiKeys, setApiKeys] = useState([]);
  const [audit, setAudit] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' });
  const [keyForm, setKeyForm] = useState({ name: '' });
  const [newKey, setNewKey] = useState(null);
  const [wsForm, setWsForm] = useState({ name: '', timezone: '', currency: '', modules: {} });

  useEffect(() => {
    loadSettings();
  }, [tab]);

  const loadSettings = async () => {
    try {
      if (tab === 'general') {
        const { data } = await api.get('/settings/general');
        setWs(data);
        setWsForm({ name: data.name || '', timezone: data.timezone || '', currency: data.currency || '', modules: data.modules || {} });
      } else if (tab === 'team') {
        const { data } = await api.get('/settings/team');
        setTeam(data);
      } else if (tab === 'api') {
        const { data } = await api.get('/settings/api');
        setApiKeys(data.items);
      } else if (tab === 'audit') {
        const { data } = await api.get('/settings/audit');
        setAudit(data.items);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveGeneral = async () => {
    try {
      await api.put('/settings/general', wsForm);
      toast.success('Configurações salvas');
      loadSettings();
    } catch (err) {
      toast.error('Erro ao salvar');
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      await api.post('/settings/team/invite', inviteForm);
      toast.success('Convite enviado');
      setShowInvite(false);
      setInviteForm({ email: '', role: 'member' });
      loadSettings();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro');
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/settings/api', { name: keyForm.name, scopes: [] });
      setNewKey(data.key);
      toast.success('Chave criada');
      setShowApiKey(false);
      setKeyForm({ name: '' });
      loadSettings();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro');
    }
  };

  const revokeKey = async (id) => {
    try {
      await api.delete(`/settings/api/${id}`);
      toast.success('Chave revogada');
      loadSettings();
    } catch (err) {
      toast.error('Erro ao revogar');
    }
  };

  return (
    <div data-testid="settings-page">
      <div className="page-header">
        <div>
          <h1>Configurações<span className="accent">.</span></h1>
          <p className="page-description">Operação, equipe, chaves, faturamento, notificações e auditoria.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="general" className="text-xs gap-1.5"><Settings size={12} /> Operação</TabsTrigger>
          <TabsTrigger value="team" className="text-xs gap-1.5"><UsersRound size={12} /> Equipe</TabsTrigger>
          <TabsTrigger value="api" className="text-xs gap-1.5"><Key size={12} /> API</TabsTrigger>
          <TabsTrigger value="billing" className="text-xs gap-1.5"><CreditCard size={12} /> Faturamento</TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs gap-1.5"><Bell size={12} /> Notificações</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><ClipboardList size={12} /> Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          {ws && (
            <div className="stat-card space-y-4 max-w-lg">
              <div><Label className="text-xs">Nome do workspace</Label><Input className="text-xs mt-1" value={wsForm.name} onChange={e => setWsForm(f => ({ ...f, name: e.target.value }))} data-testid="ws-name-input" /></div>
              <div><Label className="text-xs">Fuso horário</Label>
                <Select value={wsForm.timezone} onValueChange={v => setWsForm(f => ({ ...f, timezone: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['America/Sao_Paulo', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'UTC'].map(tz => (
                      <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Moeda</Label>
                <Select value={wsForm.currency} onValueChange={v => setWsForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['BRL', 'USD', 'EUR'].map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {ws.modules && (
                <div>
                  <Label className="text-xs mb-2 block">Módulos ativos</Label>
                  <div className="space-y-2">
                    {Object.entries(wsForm.modules).map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-xs capitalize">{key}</span>
                        <Switch checked={val} className="scale-75" data-testid={`module-${key}`}
                          onCheckedChange={v => setWsForm(f => ({ ...f, modules: { ...f.modules, [key]: v } }))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Button size="sm" onClick={saveGeneral} data-testid="save-settings-btn">Salvar alterações</Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <Button size="sm" onClick={() => setShowInvite(true)} data-testid="invite-member-btn"><Plus size={14} className="mr-1" /> Convidar</Button>
          </div>
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Nome</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Papel</TableHead>
                  <TableHead className="text-xs">Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.members.map(m => (
                  <TableRow key={m._id}>
                    <TableCell className="text-xs">{m.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.email}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{m.role}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="api" className="mt-4">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <Button size="sm" onClick={() => setShowApiKey(true)} data-testid="create-api-key-btn"><Plus size={14} className="mr-1" /> Nova chave</Button>
          </div>
          {newKey && (
            <div className="stat-card mb-4 p-3">
              <p className="text-xs font-medium mb-1">Nova chave criada (copie agora):</p>
              <code className="text-[10px] bg-muted p-2 rounded block font-mono break-all">{newKey}</code>
              <Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => { navigator.clipboard.writeText(newKey); toast.success('Copiada'); }}>Copiar</Button>
            </div>
          )}
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Nome</TableHead>
                  <TableHead className="text-xs">Prefixo</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Criada</TableHead>
                  <TableHead className="text-xs text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-8">Nenhuma chave criada</TableCell></TableRow>
                ) : apiKeys.map(k => (
                  <TableRow key={k._id}>
                    <TableCell className="text-xs">{k.name}</TableCell>
                    <TableCell className="text-[10px] font-mono">{k.key_prefix}...</TableCell>
                    <TableCell><Badge className={`text-[9px] ${k.status === 'active' ? 'badge-success' : 'badge-error'}`}>{k.status}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{new Date(k.created_at).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell className="text-right">
                      {k.status === 'active' && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => revokeKey(k._id)}><Trash2 size={13} /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="billing" className="mt-4">{tab === 'billing' && <BillingPanel />}</TabsContent>
        <TabsContent value="notifications" className="mt-4">{tab === 'notifications' && <NotificationsPanel />}</TabsContent>

        <TabsContent value="audit" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Ação</TableHead>
                  <TableHead className="text-xs">Usuário</TableHead>
                  <TableHead className="text-xs">Objeto</TableHead>
                  <TableHead className="text-xs">Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-8">Nenhum registro de auditoria</TableCell></TableRow>
                ) : audit.map(a => (
                  <TableRow key={a._id}>
                    <TableCell className="text-xs font-mono">{a.action}</TableCell>
                    <TableCell className="text-xs">{a.user_email}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{a.object_type}:{a.object_id?.slice(-8)}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{new Date(a.timestamp).toLocaleString('pt-BR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>Convidar membro</DialogTitle></DialogHeader>
          <form onSubmit={handleInvite} className="space-y-3">
            <div><Label className="text-xs">Email</Label><Input className="text-xs mt-1" type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} required /></div>
            <div><Label className="text-xs">Papel</Label>
              <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['owner', 'admin', 'gestor', 'analista', 'atendente', 'expert', 'viewer'].map(r => (
                    <SelectItem key={r} value={r} className="text-xs capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowInvite(false)}>Cancelar</Button>
              <Button type="submit">Enviar convite</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* API Key Dialog */}
      <Dialog open={showApiKey} onOpenChange={setShowApiKey}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova chave de API</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateKey} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={keyForm.name} onChange={e => setKeyForm(f => ({ ...f, name: e.target.value }))} required placeholder="Produção, Staging..." /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowApiKey(false)}>Cancelar</Button>
              <Button type="submit">Criar chave</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
