import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position,
  addEdge, useNodesState, useEdgesState, useReactFlow, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Workflow, Plus, Trash2, Play, Pause, Edit, ArrowLeft, Save, Rocket,
  MessageSquare, GitBranch, Clock3, Tags, ListTree, Shuffle, Zap, Bot,
  Webhook, UserRoundCheck, Radio, BarChart3, ListChecks, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

const NODE_TYPES = [
  { type: 'message', label: 'Mensagem', desc: 'Enviar uma mensagem', icon: MessageSquare, color: '#5b8def' },
  { type: 'condition', label: 'Condição', desc: 'Ramificar Sim/Não', icon: GitBranch, color: '#f5a524' },
  { type: 'wait', label: 'Espera', desc: 'Aguardar um tempo', icon: Clock3, color: '#60a5fa' },
  { type: 'crm_action', label: 'Ações CRM', desc: 'Mover/criar lead', icon: ListTree, color: '#16c7a3' },
  { type: 'tags', label: 'Gerenciar Tags', desc: 'Aplicar/remover tags', icon: Tags, color: '#8b5cf6' },
  { type: 'menu', label: 'Menu', desc: 'Menu de N opções', icon: ListTree, color: '#fb8b72' },
  { type: 'random', label: 'Randomizador', desc: 'Caminho aleatório', icon: Shuffle, color: '#ec4899' },
  { type: 'action', label: 'Ação Automática', desc: 'Executar ação', icon: Zap, color: '#f59e0b' },
  { type: 'ai', label: 'Inteligência IA', desc: 'Acionar/pausar IA', icon: Bot, color: '#12b8d0' },
  { type: 'webhook', label: 'Webhook', desc: 'Chamada HTTP', icon: Webhook, color: '#7890aa' },
  { type: 'handoff', label: 'Transferir', desc: 'Transferir atendimento', icon: UserRoundCheck, color: '#10b981' },
];

const iconFor = kind => NODE_TYPES.find(item => item.type === kind)?.icon || Workflow;

function AutomationNode({ data, selected }) {
  const Icon = data.kind === 'trigger' ? Radio : iconFor(data.kind);
  const color = data.kind === 'trigger' ? '#19d3ae' : (NODE_TYPES.find(item => item.type === data.kind)?.color || '#7890aa');
  return (
    <div className={`flow-node ${selected ? 'is-selected' : ''}`} style={{ '--node-color': color }}>
      {data.kind !== 'trigger' && <Handle type="target" position={Position.Top} />}
      <div className="flow-node-title"><span className="flow-node-icon"><Icon size={13} /></span>{data.label}</div>
      <div className="flow-node-description">{data.description || 'Configure esta etapa'}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const flowNodeTypes = { automation: AutomationNode };

function normalizeNodes(nodes = []) {
  if (!nodes.length) {
    return [{ id: 'trigger', type: 'automation', position: { x: 360, y: 160 }, data: { kind: 'trigger', label: 'Início', description: 'Quando o lead enviar mensagem', config: {} }, deletable: false }];
  }
  return nodes.map((node, index) => ({
    ...node, type: 'automation', position: node.position || { x: 360, y: 160 + index * 130 },
    data: node.data || { kind: node.type === 'trigger' ? 'trigger' : node.type, label: node.label || node.type, description: NODE_TYPES.find(item => item.type === node.type)?.desc, config: node.config || {} },
    deletable: node.id !== 'trigger',
  }));
}

function FlowEditor({ automation, connections, onClose, onSaved }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(normalizeNodes(automation.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(automation.edges || []);
  const [connectionId, setConnectionId] = useState(automation.connection_id || '');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [executions, setExecutions] = useState(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  const selectedNode = nodes.find(node => node.id === selectedNodeId);

  const addNodeAt = useCallback((kind, position) => {
    const definition = NODE_TYPES.find(item => item.type === kind);
    if (!definition) return;
    const id = `${kind}_${Date.now()}`;
    setNodes(current => [...current, { id, type: 'automation', position, data: { kind, label: definition.label, description: definition.desc, config: {} } }]);
    setSelectedNodeId(id);
  }, [setNodes]);

  const onDrop = useCallback(event => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/reactflow');
    if (kind) addNodeAt(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addNodeAt, screenToFlowPosition]);

  const updateSelected = (field, value) => setNodes(current => current.map(node => node.id === selectedNodeId ? { ...node, data: { ...node.data, [field]: value } } : node));
  const updateConfig = (field, value) => setNodes(current => current.map(node => node.id === selectedNodeId ? { ...node, data: { ...node.data, config: { ...(node.data.config || {}), [field]: value } } } : node));

  const save = async (publish = false) => {
    if (!connectionId) return toast.error('Selecione a conexão que executará esta automação');
    setSaving(true);
    try {
      await api.put(`/automations/${automation._id}`, {
        nodes, edges, connection_id: connectionId,
        trigger: { type: 'message', event: 'message_received' },
        ...(publish ? { status: 'active' } : {}),
      });
      toast.success(publish ? 'Automação publicada' : 'Fluxo salvo');
      onSaved();
      if (publish) onClose();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro ao salvar o fluxo'); }
    finally { setSaving(false); }
  };

  const openAnalytics = async () => {
    setPanelLoading(true); setAnalytics({ loading: true });
    try { const { data } = await api.get(`/automations/${automation._id}/analytics`); setAnalytics(data); }
    catch { toast.error('Erro ao carregar analytics'); setAnalytics(null); }
    finally { setPanelLoading(false); }
  };

  const openExecutions = async () => {
    setPanelLoading(true); setExecutions({ items: [], loading: true });
    try { const { data } = await api.get(`/automations/${automation._id}/executions`); setExecutions(data); }
    catch { toast.error('Erro ao carregar execuções'); setExecutions(null); }
    finally { setPanelLoading(false); }
  };

  return (
    <div className="automation-editor" data-testid="automation-editor">
      <header className="automation-editor-header">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Voltar"><ArrowLeft size={17} /></Button>
        <div className="automation-title"><strong>{automation.name}</strong><span>{nodes.length} blocos · {edges.length} conexões</span></div>
        <div className="automation-header-actions">
          <Button variant="ghost" size="sm" onClick={openAnalytics}><BarChart3 size={13} className="mr-2" />Analytics</Button>
          <Button variant="ghost" size="sm" onClick={openExecutions}><ListChecks size={13} className="mr-2" />Execuções</Button>
          <Button variant="outline" size="sm" onClick={() => save(false)} disabled={saving}><Save size={13} className="mr-2" />Salvar</Button>
          <Button size="sm" onClick={() => save(true)} disabled={saving}><Rocket size={13} className="mr-2" />Publicar</Button>
        </div>
      </header>

      <div className="automation-editor-body">
        <aside className="flow-palette">
          <p className="flow-section-title">BLOCOS BÁSICOS</p>
          {NODE_TYPES.slice(0, 4).map(item => <PaletteItem key={item.type} item={item} onAdd={() => addNodeAt(item.type, { x: 360, y: 220 + nodes.length * 30 })} />)}
          <p className="flow-section-title flow-section-spaced">LÓGICA AVANÇADA</p>
          {NODE_TYPES.slice(4).map(item => <PaletteItem key={item.type} item={item} onAdd={() => addNodeAt(item.type, { x: 360, y: 220 + nodes.length * 30 })} />)}
        </aside>

        <main className="flow-canvas" onDrop={onDrop} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={flowNodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={connection => setEdges(current => addEdge({ ...connection, type: 'smoothstep', animated: true }, current))}
            onSelectionChange={({ nodes: selected }) => setSelectedNodeId(selected[0]?.id || null)} fitView colorMode="dark"
            defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: '#3d6d68' } }} deleteKeyCode={['Backspace', 'Delete']}>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1d4944" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={node => node.data.kind === 'trigger' ? '#19d3ae' : '#5277d8'} maskColor="rgba(3, 22, 20, .78)" />
          </ReactFlow>
        </main>

        <aside className="flow-settings">
          <p className="flow-settings-heading">Configuração do fluxo</p>
          <div className="flow-field"><Label>Conexão que executará</Label><Select value={connectionId} onValueChange={setConnectionId}><SelectTrigger data-testid="automation-connection"><SelectValue placeholder="Selecione WhatsApp ou Telegram" /></SelectTrigger><SelectContent>{connections.map(connection => <SelectItem key={connection._id} value={connection._id}>{connection.name} · {connection.provider === 'whatsapp' ? 'WhatsApp' : 'Telegram'}</SelectItem>)}</SelectContent></Select><small>Leads que enviarem mensagem nesta conexão entrarão no fluxo.</small></div>
          <div className="trigger-summary"><Radio size={15} /><div><strong>Mensagem recebida</strong><span>Gatilho inicial desta automação</span></div></div>
          {selectedNode && selectedNode.data.kind !== 'trigger' ? (
            <div className="node-settings"><div className="flow-settings-heading">Bloco selecionado</div>
              <div className="flow-field"><Label>Nome</Label><Input value={selectedNode.data.label || ''} onChange={event => updateSelected('label', event.target.value)} /></div>
              <div className="flow-field"><Label>Descrição</Label><Input value={selectedNode.data.description || ''} onChange={event => updateSelected('description', event.target.value)} /></div>
              {selectedNode.data.kind === 'message' && <div className="flow-field"><Label>Mensagem</Label><Textarea rows={5} placeholder="Olá! Como posso ajudar?" value={selectedNode.data.config?.text || ''} onChange={event => updateConfig('text', event.target.value)} /></div>}
              {selectedNode.data.kind === 'wait' && <div className="flow-field"><Label>Espera (minutos)</Label><Input type="number" min="1" value={selectedNode.data.config?.minutes || ''} onChange={event => updateConfig('minutes', event.target.value)} /></div>}
              {selectedNode.data.kind === 'webhook' && <div className="flow-field"><Label>URL</Label><Input placeholder="https://..." value={selectedNode.data.config?.url || ''} onChange={event => updateConfig('url', event.target.value)} /></div>}
              <Button variant="outline" className="w-full text-destructive" onClick={() => { setNodes(current => current.filter(node => node.id !== selectedNodeId)); setEdges(current => current.filter(edge => edge.source !== selectedNodeId && edge.target !== selectedNodeId)); setSelectedNodeId(null); }}><Trash2 size={13} className="mr-2" />Excluir bloco</Button>
            </div>
          ) : <p className="flow-settings-empty">Selecione um bloco para editar suas propriedades.</p>}
        </aside>
      </div>
      <AutomationAnalyticsDialog open={!!analytics} data={analytics} nodes={nodes} name={automation.name} loading={panelLoading} onClose={() => setAnalytics(null)} onRefresh={openAnalytics} />
      <AutomationExecutionsDialog open={!!executions} data={executions} loading={panelLoading} onClose={() => setExecutions(null)} onRefresh={openExecutions} />
    </div>
  );
}

function PaletteItem({ item, onAdd }) {
  const Icon = item.icon;
  return <button type="button" className="palette-item" draggable onDragStart={event => { event.dataTransfer.setData('application/reactflow', item.type); event.dataTransfer.effectAllowed = 'move'; }} onClick={onAdd}><span style={{ background: item.color }}><Icon size={15} /></span><div><strong>{item.label}</strong><small>{item.desc}</small></div></button>;
}

function AutomationAnalyticsDialog({ open, data, nodes, name, loading, onClose, onRefresh }) {
  const metrics = [
    ['Total', data?.total || 0], ['Concluídas', data?.completed || 0], ['Aguardando', data?.waiting || 0],
    ['Falhas', data?.failed || 0], ['Conversão', `${data?.conversion_rate || 0}%`], ['Tempo médio', `${data?.average_minutes || 0} min`],
  ];
  const maxHits = Math.max(1, ...Object.values(data?.node_hits || {}));
  return <Dialog open={open} onOpenChange={value => !value && onClose()}><DialogContent className="automation-data-dialog max-w-4xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 size={16} />Analytics · {name}</DialogTitle></DialogHeader>
    <DialogDescription className="sr-only">Métricas, funil por bloco e execuções recentes desta automação.</DialogDescription>
    <Button variant="ghost" size="icon" className="dialog-refresh" onClick={onRefresh} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></Button>
    <div className="analytics-metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="automation-data-section"><h4>Funil por bloco</h4>{nodes.length ? <div className="node-funnel">{nodes.map(node => { const hits = data?.node_hits?.[node.id] || (node.data.kind === 'trigger' ? data?.total || 0 : 0); return <div key={node.id}><div><span>{node.data.label}</span><strong>{hits}</strong></div><i style={{ width: `${Math.max(3, hits / maxHits * 100)}%` }} /></div>; })}</div> : <p>Sem blocos configurados.</p>}</div>
    <div className="automation-data-section"><h4>Últimas execuções — onde cada lead chegou</h4>{data?.recent?.length ? <div className="recent-runs">{data.recent.map(run => <div key={run._id}><Badge variant="outline">{run.status}</Badge><span>{run.current_node_id || 'Gatilho inicial'}</span><time>{new Date(run.created_at).toLocaleString('pt-BR')}</time></div>)}</div> : <p>Sem execuções registradas ainda.</p>}</div>
  </DialogContent></Dialog>;
}

function AutomationExecutionsDialog({ open, data, loading, onClose, onRefresh }) {
  return <Dialog open={open} onOpenChange={value => !value && onClose()}><DialogContent className="automation-data-dialog max-w-4xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><ListChecks size={16} />Execuções do fluxo</DialogTitle></DialogHeader>
    <DialogDescription className="sr-only">Lista de leads que entraram neste fluxo e o estado atual de cada execução.</DialogDescription>
    <Button variant="ghost" size="icon" className="dialog-refresh" onClick={onRefresh} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></Button>
    {data?.items?.length ? <div className="executions-table"><Table><TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Status</TableHead><TableHead>Etapa atual</TableHead><TableHead>Início</TableHead></TableRow></TableHeader><TableBody>{data.items.map(run => <TableRow key={run._id}><TableCell>{run.player_name}</TableCell><TableCell><Badge variant="outline">{run.status}</Badge></TableCell><TableCell>{run.current_node_id || 'Gatilho inicial'}</TableCell><TableCell>{new Date(run.created_at).toLocaleString('pt-BR')}</TableCell></TableRow>)}</TableBody></Table></div> : <div className="automation-empty-runs"><ListChecks size={28} /><p>Nenhuma execução registrada ainda.</p><span>Ative o fluxo para começar.</span></div>}
    <div className="executions-footnote">Clique em uma linha para ver o log detalhado.</div>
  </DialogContent></Dialog>;
}

export default function AutomationsPage() {
  const [items, setItems] = useState([]);
  const [connections, setConnections] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showEditor, setShowEditor] = useState(null);
  const [form, setForm] = useState({ name: '', connection_id: '' });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const [automations, integrations] = await Promise.all([api.get(`/automations?${params}`), api.get('/integrations?category=messaging&limit=100')]);
      setItems(automations.data.items); setTotal(automations.data.total);
      setConnections(integrations.data.items.filter(item => ['telegram', 'whatsapp'].includes(item.provider)));
    } catch { toast.error('Erro ao carregar automações'); }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);
  const connectionNames = useMemo(() => Object.fromEntries(connections.map(item => [item._id, item.name])), [connections]);

  const handleCreate = async event => {
    event.preventDefault();
    if (!form.connection_id) return toast.error('Selecione uma conexão');
    try {
      const { data } = await api.post('/automations', { name: form.name, connection_id: form.connection_id, trigger: { type: 'message', event: 'message_received' }, nodes: normalizeNodes([]), edges: [], status: 'draft' });
      setShowCreate(false); setForm({ name: '', connection_id: '' }); setShowEditor(data); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro ao criar'); }
  };
  const openEditor = async id => { try { const { data } = await api.get(`/automations/${id}`); setShowEditor(data); } catch { toast.error('Erro ao abrir automação'); } };
  const toggleStatus = async item => { const status = item.status === 'active' ? 'paused' : 'active'; try { await api.put(`/automations/${item._id}`, { status }); toast.success(status === 'active' ? 'Automação ativada' : 'Automação pausada'); load(); } catch (err) { toast.error(err.response?.data?.detail || 'Erro ao alterar status'); } };
  const remove = async id => { if (!window.confirm('Remover automação?')) return; try { await api.delete(`/automations/${id}`); toast.success('Automação removida'); load(); } catch { toast.error('Erro ao remover'); } };

  if (showEditor) return <ReactFlowProvider><FlowEditor automation={showEditor} connections={connections} onClose={() => setShowEditor(null)} onSaved={load} /></ReactFlowProvider>;

  return <div data-testid="automations-page">
    <div className="page-header"><div><h1>Automações<span className="accent">.</span></h1><p className="page-description">Crie jornadas visuais acionadas pelas suas conexões de mensagem.</p></div><Button onClick={() => setShowCreate(true)} data-testid="create-automation-btn"><Plus size={14} className="mr-2" />Nova automação</Button></div>
    <div className="data-toolbar"><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="draft">Rascunho</SelectItem><SelectItem value="active">Ativo</SelectItem><SelectItem value="paused">Pausado</SelectItem></SelectContent></Select><Badge variant="outline" className="text-[9px] ml-auto">{total} automações</Badge></div>
    <div className="stat-card" style={{ overflow: 'auto' }}><Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Conexão</TableHead><TableHead>Status</TableHead><TableHead>Fluxo</TableHead><TableHead>Execuções</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{items.length === 0 ? <TableRow><TableCell colSpan={6}><div className="empty-state"><Workflow size={32} /><h3>Nenhuma automação</h3><p>Crie um fluxo e conecte-o ao WhatsApp ou Telegram.</p></div></TableCell></TableRow> : items.map(item => <TableRow key={item._id}><TableCell className="text-xs font-medium">{item.name}</TableCell><TableCell className="text-xs">{connectionNames[item.connection_id] || 'Não selecionada'}</TableCell><TableCell><Badge className={`text-[9px] ${item.status === 'active' ? 'badge-success' : item.status === 'paused' ? 'badge-warning' : ''}`}>{item.status}</Badge></TableCell><TableCell className="text-xs">{(item.nodes || []).length} blocos · {(item.edges || []).length} conexões</TableCell><TableCell className="text-xs">{item.executions || 0}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditor(item._id)}><Edit size={13} /></Button><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleStatus(item)}>{item.status === 'active' ? <Pause size={13} /> : <Play size={13} />}</Button><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(item._id)}><Trash2 size={13} /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>
    <Dialog open={showCreate} onOpenChange={setShowCreate}><DialogContent data-testid="create-automation-dialog"><DialogHeader><DialogTitle>Nova automação</DialogTitle></DialogHeader><form onSubmit={handleCreate} className="space-y-4"><div><Label>Nome</Label><Input className="mt-1" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ex.: Boas-vindas Telegram" required /></div><div><Label>Conexão</Label><Select value={form.connection_id} onValueChange={value => setForm(current => ({ ...current, connection_id: value }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Selecione WhatsApp ou Telegram" /></SelectTrigger><SelectContent>{connections.map(connection => <SelectItem key={connection._id} value={connection._id}>{connection.name} · {connection.provider}</SelectItem>)}</SelectContent></Select><p className="text-[10px] text-muted-foreground mt-1">Mensagens recebidas nesta conexão iniciarão o fluxo.</p></div>{connections.length === 0 && <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-900 rounded-md p-3">Configure primeiro uma integração de WhatsApp ou Telegram.</div>}<DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" disabled={!connections.length} data-testid="submit-automation">Criar e editar</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
