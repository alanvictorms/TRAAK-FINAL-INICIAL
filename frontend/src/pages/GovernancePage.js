import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Shield, CheckSquare, Lock, Eye, ClipboardList, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function GovernancePage() {
  const [tab, setTab] = useState('policies');
  const [policies, setPolicies] = useState([]);
  const [killSwitches, setKillSwitches] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [audit, setAudit] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        if (tab === 'policies' || tab === 'killswitches') {
          const { data } = await api.get('/governance');
          setPolicies(data.policies || []);
          setKillSwitches(data.kill_switches || []);
        }
        if (tab === 'approvals') {
          const { data } = await api.get('/approvals');
          setApprovals(data.items || []);
        }
        if (tab === 'audit') {
          const { data } = await api.get('/settings/audit');
          setAudit(data.items || []);
        }
      } catch {}
    };
    load();
  }, [tab]);

  const decideApproval = async (id, decision) => {
    try {
      await api.post(`/approvals/${id}/decide`, { decision });
      toast.success(`Aprovação ${decision === 'approved' ? 'aprovada' : 'rejeitada'}`);
      const { data } = await api.get('/approvals');
      setApprovals(data.items || []);
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  return (
    <div data-testid="governance-page">
      <div className="page-header">
        <div><h1>Governança<span className="accent">.</span></h1><p className="page-description">Políticas, aprovações, kill switches, PII vault e auditoria.</p></div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="policies" className="text-xs gap-1.5"><Shield size={12} /> Políticas</TabsTrigger>
          <TabsTrigger value="approvals" className="text-xs gap-1.5"><CheckSquare size={12} /> Aprovações</TabsTrigger>
          <TabsTrigger value="killswitches" className="text-xs gap-1.5"><Lock size={12} /> Kill Switches</TabsTrigger>
          <TabsTrigger value="pii" className="text-xs gap-1.5"><Eye size={12} /> PII Vault</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><ClipboardList size={12} /> Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="policies" className="mt-4">
          <div className="stat-card p-4">
            {policies.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-2">Policy Engine</p>
                <p>Políticas avaliam tenant, ator, capacidade, dados, limites, versão e contexto antes de propor e antes de executar ações. Configure políticas conforme as necessidades da operação.</p>
                <p className="mt-2">Definições de separação, limiares e execução recorrente em D08.</p>
              </div>
            ) : policies.map(p => (
              <div key={p._id} className="flex items-center justify-between p-2 border-b border-border">
                <span className="text-xs">{p.name}</span>
                <Badge className={`text-[9px] ${p.active ? 'badge-success' : ''}`}>{p.active ? 'Ativa' : 'Inativa'}</Badge>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Objeto</TableHead>
                <TableHead className="text-xs">Proponente</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Data</TableHead>
                <TableHead className="text-xs text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {approvals.length === 0 ? (
                  <TableRow><TableCell colSpan={6}><div className="empty-state"><CheckSquare size={28} /><h3>Sem aprovações pendentes</h3></div></TableCell></TableRow>
                ) : approvals.map(a => (
                  <TableRow key={a._id}>
                    <TableCell className="text-xs">{a.type}</TableCell>
                    <TableCell className="text-[10px] font-mono">{a.object_type}:{a.object_id?.slice(-8)}</TableCell>
                    <TableCell className="text-xs">{a.proposed_by_name}</TableCell>
                    <TableCell><Badge className={`text-[9px] ${a.status === 'approved' ? 'badge-success' : a.status === 'rejected' ? 'badge-error' : 'badge-warning'}`}>{a.status}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right">
                      {a.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <Button size="sm" className="text-[10px] h-6" onClick={() => decideApproval(a._id, 'approved')}>Aprovar</Button>
                          <Button size="sm" variant="outline" className="text-[10px] h-6 text-destructive" onClick={() => decideApproval(a._id, 'rejected')}>Rejeitar</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="killswitches" className="mt-4">
          <div className="stat-card p-4">
            <p className="text-xs font-medium mb-3">Kill Switches</p>
            <p className="text-[10px] text-muted-foreground mb-4">Bloqueios de capacidade que prevalecem na execução mesmo após aprovação.</p>
            {['Meta — Escrita CAPI', 'CAPI — Envio de eventos', 'Telegram — Envio de mensagens', 'SMS — Disparos', 'Voz — Chamadas'].map(name => (
              <div key={name} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs">{name}</span>
                <div className="flex items-center gap-2">
                  <Badge className="text-[8px] badge-success">Ativo</Badge>
                  <Switch defaultChecked className="scale-75" />
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pii" className="mt-4">
          <div className="stat-card p-4">
            <div className="flex items-center gap-2 mb-3"><Eye size={14} className="text-primary" /><span className="text-xs font-medium">PII Vault</span></div>
            <p className="text-[10px] text-muted-foreground">Dados pessoais mascarados por padrão. Abertura do cofre exige permissão e motivo, registrando autor, objeto, campo, data e duração. PII não é exposto em logs ou exportações sem direito específico.</p>
            <div className="mt-4 stat-card p-3">
              <p className="text-[10px] text-muted-foreground">Nenhum acesso ao cofre registrado nesta sessão.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Ação</TableHead>
                <TableHead className="text-xs">Usuário</TableHead>
                <TableHead className="text-xs">Objeto</TableHead>
                <TableHead className="text-xs">Data</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {audit.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-8">Nenhum registro</TableCell></TableRow>
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
    </div>
  );
}
