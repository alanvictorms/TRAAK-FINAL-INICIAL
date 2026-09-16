import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Search, Workflow, Plus, Trash2, Play, Pause, Edit } from 'lucide-react';
import { toast } from 'sonner';

const NODE_TYPES = [
  { type: 'trigger', label: 'Gatilho', desc: 'Iniciar por evento' },
  { type: 'message', label: 'Mensagem', desc: 'Texto, mídia e botões' },
  { type: 'question', label: 'Pergunta', desc: 'Coletar resposta' },
  { type: 'sms', label: 'Enviar SMS', desc: 'Conteúdo tarifado' },
  { type: 'call', label: 'Ligação', desc: 'Atendeu, caixa postal, não atendeu' },
  { type: 'condition', label: 'Condição', desc: 'Ramificar conforme dados' },
  { type: 'wait', label: 'Espera', desc: 'Aguardar entre etapas' },
  { type: 'ab_test', label: 'Teste A/B', desc: 'Distribuir público' },
  { type: 'action', label: 'Ação', desc: 'Alterar tag/atributo' },
  { type: 'conversion', label: 'Conversão', desc: 'Encaminhar evento' },
  { type: 'ai', label: 'IA', desc: 'Processamento por modelo' },
  { type: 'handoff', label: 'Atendimento', desc: 'Transferir para humano' },
  { type: 'jump', label: 'Saltar', desc: 'Encaminhar a outro fluxo' },
];

export default function AutomationsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showEditor, setShowEditor] = useState(null);
  const [form, setForm] = useState({ name: '', trigger: { type: 'event', event: '' }, nodes: [] });
  const [editNodes, setEditNodes] = useState([]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (statusFilter !== 'all') p.set('status', statusFilter);
      const { data } = await api.get(`/automations?${p}`);
      setItems(data.items); setTotal(data.total);
    } catch {}
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/automations', form);
      toast.success('Automação criada'); setShowCreate(false);
      setForm({ name: '', trigger: { type: 'event', event: '' }, nodes: [] }); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const toggleStatus = async (item) => {
    const newStatus = item.status === 'active' ? 'paused' : item.status === 'paused' ? 'active' : 'active';
    try {
      await api.put(`/automations/${item._id}`, { status: newStatus });
      toast.success(`Automação ${newStatus === 'active' ? 'ativada' : 'pausada'}`); load();
    } catch { toast.error('Erro'); }
  };

  const openEditor = async (id) => {
    try {
      const { data } = await api.get(`/automations/${id}`);
      setShowEditor(data);
      setEditNodes(data.nodes || []);
    } catch {}
  };

  const addNode = (type) => {
    const nt = NODE_TYPES.find(n => n.type === type);
    setEditNodes(prev => [...prev, { id: `node_${Date.now()}`, type, label: nt?.label || type, config: {} }]);
  };

  const removeNode = (idx) => setEditNodes(prev => prev.filter((_, i) => i !== idx));

  const saveNodes = async () => {
    if (!showEditor) return;
    try {
      await api.put(`/automations/${showEditor._id}`, { nodes: editNodes });
      toast.success('Fluxo salvo'); load();
    } catch { toast.error('Erro ao salvar'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover automação?')) return;
    try { await api.delete(`/automations/${id}`); toast.success('Removida'); load(); } catch { toast.error('Erro'); }
  };

  const statusColors = { draft: '', active: 'badge-success', paused: 'badge-warning' };

  return (
    <div data-testid="automations-page">
      <div className="page-header">
        <div><h1>Automações<span className="accent">.</span></h1><p className="page-description">Fluxos automatizados com gatilhos, condições e ações.</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-automation-btn"><Plus size={14} className="mr-2" /> Novo fluxo</Button>
      </div>
      <div className="data-toolbar">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todos</SelectItem>
            <SelectItem value="draft" className="text-xs">Rascunho</SelectItem>
            <SelectItem value="active" className="text-xs">Ativo</SelectItem>
            <SelectItem value="paused" className="text-xs">Pausado</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[9px] ml-auto">{total} automações</Badge>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Nome</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Versão</TableHead>
            <TableHead className="text-xs">Nós</TableHead>
            <TableHead className="text-xs">Execuções</TableHead>
            <TableHead className="text-xs">Conversões</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><Workflow size={32} /><h3>Nenhuma automação</h3><p>Crie fluxos para automatizar jornadas de aquisição.</p></div></TableCell></TableRow>
            ) : items.map(a => (
              <TableRow key={a._id}>
                <TableCell className="text-xs font-medium">{a.name}</TableCell>
                <TableCell><Badge className={`text-[9px] ${statusColors[a.status] || ''}`}>{a.status}</Badge></TableCell>
                <TableCell className="text-xs">v{a.version || 1}</TableCell>
                <TableCell className="text-xs">{(a.nodes || []).length}</TableCell>
                <TableCell className="text-xs">{a.executions || 0}</TableCell>
                <TableCell className="text-xs">{a.conversions || 0}</TableCell>
                <TableCell className="text-right">
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditor(a._id)} data-testid={`edit-${a._id}`}><Edit size={13} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleStatus(a)}>{a.status === 'active' ? <Pause size={13} /> : <Play size={13} />}</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(a._id)}><Trash2 size={13} /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-automation-dialog">
          <DialogHeader><DialogTitle>Novo fluxo</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label className="text-xs">Gatilho</Label><Input className="text-xs mt-1" value={form.trigger.event} onChange={e => setForm(f => ({ ...f, trigger: { ...f.trigger, event: e.target.value } }))} placeholder="Ex: click, register, ftd..." /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" data-testid="submit-automation">Criar rascunho</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Flow Editor */}
      <Dialog open={!!showEditor} onOpenChange={() => setShowEditor(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto" data-testid="automation-editor">
          <DialogHeader><DialogTitle>Editor: {showEditor?.name}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-[200px_1fr] gap-4">
            {/* Node palette */}
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground mb-2 font-medium">PALETA DE NÓS</p>
              {NODE_TYPES.map(nt => (
                <Button key={nt.type} variant="outline" size="sm" className="w-full justify-start text-[10px] h-7 gap-2" onClick={() => addNode(nt.type)}>
                  <Plus size={10} /> {nt.label}
                </Button>
              ))}
            </div>
            {/* Canvas */}
            <div className="space-y-2 min-h-[300px]">
              <p className="text-[10px] text-muted-foreground font-medium">FLUXO ({editNodes.length} nós)</p>
              {editNodes.length === 0 ? (
                <div className="text-center text-[10px] text-muted-foreground py-12">Adicione nós da paleta ao lado.</div>
              ) : editNodes.map((node, i) => (
                <div key={node.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-card">
                  <Badge variant="outline" className="text-[8px]">{i + 1}</Badge>
                  <div className="flex-1">
                    <span className="text-[10px] font-medium">{node.label}</span>
                    <span className="text-[9px] text-muted-foreground ml-2">{NODE_TYPES.find(n => n.type === node.type)?.desc}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeNode(i)}><Trash2 size={10} /></Button>
                </div>
              ))}
              {editNodes.length > 0 && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="text-xs" onClick={saveNodes}>Salvar fluxo</Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => { saveNodes(); toggleStatus(showEditor); }}>Publicar</Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
