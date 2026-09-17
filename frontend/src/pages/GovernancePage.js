import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Shield, CheckSquare, Lock, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = { pending: ['Pendente', 'badge-warning'], approved: ['Aprovada', 'badge-success'], rejected: ['Rejeitada', 'badge-error'] };
const APPROVAL_TYPES = { dispatch_send: 'Envio de disparo' };
const EMPTY_POLICY = { name: '', type: 'dispatch_approval', config: { min_recipients: 500, start_hour: 8, end_hour: 20 } };

const describePolicy = (p) => (p.type === 'dispatch_approval'
  ? `Disparo com ${p.config.min_recipients}+ destinatários espera aprovação`
  : `Disparos só saem entre ${p.config.start_hour}h e ${p.config.end_hour}h`);

const fail = err => toast.error(formatApiError(err.response?.data?.detail));

function Policies({ data, reload }) {
  const [form, setForm] = useState(null);
  const create = async (e) => {
    e.preventDefault();
    const config = form.type === 'dispatch_approval'
      ? { min_recipients: Number(form.config.min_recipients) }
      : { start_hour: Number(form.config.start_hour), end_hour: Number(form.config.end_hour) };
    try { await api.post('/governance/policies', { name: form.name, type: form.type, config }); toast.success('Política criada'); setForm(null); reload(); }
    catch (err) { fail(err); }
  };
  const setStatus = async (p, active) => {
    try { await api.put(`/governance/policies/${p._id}`, { status: active ? 'active' : 'inactive' }); reload(); } catch (err) { fail(err); }
  };
  const remove = async (p) => {
    if (!window.confirm(`Remover a política “${p.name}”?`)) return;
    try { await api.delete(`/governance/policies/${p._id}`); reload(); } catch (err) { fail(err); }
  };
  const setConfig = patch => setForm(f => ({ ...f, config: { ...f.config, ...patch } }));
  return (
    <div className="stat-card" style={{ overflow: 'auto' }}>
      <div className="flex items-center justify-between p-3">
        <p className="text-[10px] text-muted-foreground">Políticas ativas valem na hora de enviar. Com mais de uma do mesmo tipo, vale a mais recente.</p>
        <Button size="sm" onClick={() => setForm(EMPTY_POLICY)} data-testid="create-policy"><Plus size={13} className="mr-1" /> Nova política</Button>
      </div>
      <Table>
        <TableHeader><TableRow>{['Nome', 'Regra', 'Ativa', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {data.policies.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-8">Nenhuma política. Exemplo: exigir aprovação para disparo acima de 500 pessoas.</TableCell></TableRow>
          )}
          {data.policies.map(p => (
            <TableRow key={p._id}>
              <TableCell className="text-xs font-medium">{p.name}</TableCell>
              <TableCell className="text-[10px]">{describePolicy(p)}</TableCell>
              <TableCell><Switch checked={p.status === 'active'} onCheckedChange={v => setStatus(p, v)} /></TableCell>
              <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(p)}><Trash2 size={13} /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova política</DialogTitle></DialogHeader>
          {form && (
            <form onSubmit={create} className="space-y-3">
              <div><Label className="text-xs">Nome</Label><Input required className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label className="text-xs">Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(data.policy_types).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.type === 'dispatch_approval' ? (
                <div><Label className="text-xs">Exigir aprovação a partir de quantos destinatários</Label>
                  <Input type="number" min={1} required className="text-xs mt-1" value={form.config.min_recipients} onChange={e => setConfig({ min_recipients: e.target.value })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Das (hora)</Label><Input type="number" min={0} max={23} required className="text-xs mt-1" value={form.config.start_hour} onChange={e => setConfig({ start_hour: e.target.value })} /></div>
                  <div><Label className="text-xs">Até (hora, sem incluir)</Label><Input type="number" min={0} max={23} required className="text-xs mt-1" value={form.config.end_hour} onChange={e => setConfig({ end_hour: e.target.value })} /></div>
                  <p className="col-span-2 text-[10px] text-muted-foreground">Fora da janela o disparo fica em espera e continua sozinho quando ela abre. Hora no fuso do workspace.</p>
                </div>
              )}
              <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit">Criar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KillSwitches({ data, reload }) {
  const [pending, setPending] = useState(null);
  const apply = async (key, active, reason = '') => {
    try {
      await api.put(`/governance/kill-switches/${key}`, { active, reason });
      toast.success(active ? 'Bloqueado' : 'Liberado'); setPending(null); reload();
    } catch (err) { fail(err); }
  };
  return (
    <div className="stat-card p-4">
      <p className="text-[10px] text-muted-foreground mb-3">Ligar um bloqueio para a função no workspace inteiro, na hora, até alguém liberar. Automações e disparos ficam em espera, nada se perde.</p>
      {data.kill_switches.map(k => (
        <div key={k.key} className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-3">
          <div>
            <p className="text-xs">{k.label}</p>
            {k.active && <p className="text-[10px] text-muted-foreground">Bloqueado por {k.changed_by_name || '—'} em {new Date(k.changed_at).toLocaleString('pt-BR')}: {k.reason}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`text-[8px] ${k.active ? 'badge-error' : 'badge-success'}`}>{k.active ? 'Bloqueado' : 'Funcionando'}</Badge>
            <Switch checked={k.active} data-testid={`kill-${k.key}`}
              onCheckedChange={v => (v ? setPending({ key: k.key, label: k.label, reason: '' }) : apply(k.key, false))} />
          </div>
        </div>
      ))}
      <Dialog open={!!pending} onOpenChange={o => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bloquear: {pending?.label}</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); apply(pending.key, true, pending.reason); }} className="space-y-3">
            <div><Label className="text-xs">Motivo (o time é avisado)</Label>
              <Input required minLength={5} className="text-xs mt-1" value={pending?.reason || ''} onChange={e => setPending(p => ({ ...p, reason: e.target.value }))} />
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setPending(null)}>Cancelar</Button><Button type="submit" variant="destructive">Bloquear</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Approvals() {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState([]);
  const load = useCallback(() => {
    api.get('/approvals', { params: status === 'all' ? {} : { status } }).then(r => setItems(r.data.items)).catch(() => {});
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (id, decision) => {
    const note = decision === 'rejected' ? window.prompt('Motivo da rejeição (opcional)') : '';
    if (note === null) return;
    try { await api.post(`/approvals/${id}/decide`, { decision, note }); toast.success(decision === 'approved' ? 'Aprovado' : 'Rejeitado'); load(); }
    catch (err) { fail(err); }
  };
  return (
    <div className="stat-card" style={{ overflow: 'auto' }}>
      <div className="p-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending" className="text-xs">Pendentes</SelectItem>
            <SelectItem value="approved" className="text-xs">Aprovadas</SelectItem>
            <SelectItem value="rejected" className="text-xs">Rejeitadas</SelectItem>
            <SelectItem value="all" className="text-xs">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader><TableRow>{['Pedido', 'Detalhe', 'Quem pediu', 'Status', 'Data'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}<TableHead className="text-xs text-right">Decisão</TableHead></TableRow></TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow><TableCell colSpan={6}><div className="empty-state"><CheckSquare size={28} /><h3>Nada aqui</h3></div></TableCell></TableRow>
          )}
          {items.map(a => (
            <TableRow key={a._id}>
              <TableCell className="text-xs">{APPROVAL_TYPES[a.type] || a.type}{a.plan?.name ? `: ${a.plan.name}` : ''}</TableCell>
              <TableCell className="text-[10px] text-muted-foreground max-w-[280px]">{a.justification}</TableCell>
              <TableCell className="text-xs">{a.proposed_by_name}</TableCell>
              <TableCell>
                <Badge className={`text-[9px] ${(STATUS[a.status] || [])[1] || ''}`}>{(STATUS[a.status] || [a.status])[0]}</Badge>
                {a.decided_by_name && <p className="text-[9px] text-muted-foreground">por {a.decided_by_name}{a.decision_note ? `: ${a.decision_note}` : ''}</p>}
              </TableCell>
              <TableCell className="text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleString('pt-BR')}</TableCell>
              <TableCell className="text-right">
                {a.status === 'pending' && (
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" className="text-[10px] h-6" onClick={() => decide(a._id, 'approved')} data-testid={`approve-${a._id}`}>Aprovar</Button>
                    <Button size="sm" variant="outline" className="text-[10px] h-6 text-destructive" onClick={() => decide(a._id, 'rejected')}>Rejeitar</Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Audit() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get('/settings/audit').then(r => setItems(r.data.items || [])).catch(() => {}); }, []);
  return (
    <div className="stat-card" style={{ overflow: 'auto' }}>
      <Table>
        <TableHeader><TableRow>{['Ação', 'Usuário', 'Objeto', 'Data'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {items.length === 0 && <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-8">Nenhum registro</TableCell></TableRow>}
          {items.map(a => (
            <TableRow key={a._id}>
              <TableCell className="text-xs font-mono">{a.action}</TableCell>
              <TableCell className="text-xs">{a.user_email}</TableCell>
              <TableCell className="text-[10px] text-muted-foreground">{a.object_type ? `${a.object_type}:${(a.object_id || '').slice(-8)}` : '—'}</TableCell>
              <TableCell className="text-[10px] text-muted-foreground">{new Date(a.timestamp).toLocaleString('pt-BR')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function GovernancePage() {
  const location = useLocation();
  const [tab, setTab] = useState(location.pathname.startsWith('/approvals') ? 'approvals' : 'policies');
  const [data, setData] = useState({ policies: [], kill_switches: [], policy_types: {} });
  const reload = useCallback(() => api.get('/governance').then(r => setData(r.data)).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div data-testid="governance-page">
      <div className="page-header">
        <div><h1>Governança<span className="accent">.</span></h1><p className="page-description">Políticas, aprovações, bloqueios de emergência e auditoria.</p></div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="policies" className="text-xs gap-1.5"><Shield size={12} /> Políticas</TabsTrigger>
          <TabsTrigger value="approvals" className="text-xs gap-1.5"><CheckSquare size={12} /> Aprovações</TabsTrigger>
          <TabsTrigger value="killswitches" className="text-xs gap-1.5"><Lock size={12} /> Bloqueios</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><ClipboardList size={12} /> Auditoria</TabsTrigger>
        </TabsList>
        <TabsContent value="policies" className="mt-4"><Policies data={data} reload={reload} /></TabsContent>
        <TabsContent value="approvals" className="mt-4"><Approvals /></TabsContent>
        <TabsContent value="killswitches" className="mt-4"><KillSwitches data={data} reload={reload} /></TabsContent>
        <TabsContent value="audit" className="mt-4"><Audit /></TabsContent>
      </Tabs>
    </div>
  );
}
