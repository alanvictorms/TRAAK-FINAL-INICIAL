import { useState, useEffect, useCallback, useMemo } from 'react';
import { statusLabel } from '@/lib/labels';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position,
  addEdge, useNodesState, useEdgesState, useReactFlow, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useNavigate, useParams } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
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
  Webhook, UserRoundCheck, Radio, BarChart3, ListChecks, RefreshCw, History, FlaskConical,
} from 'lucide-react';
import { toast } from 'sonner';

const NODE_TYPES = [
  { type: 'message', label: 'Mensagem', desc: 'Enviar uma mensagem', icon: MessageSquare, color: '#8fe388' },
  { type: 'condition', label: 'Condição', desc: 'Ramificar Sim/Não', icon: GitBranch, color: '#d8c46a' },
  { type: 'wait', label: 'Espera', desc: 'Aguardar um tempo', icon: Clock3, color: '#6fbfa8' },
  { type: 'crm_action', label: 'Ações CRM', desc: 'Mover/criar lead', icon: ListTree, color: '#46c39a' },
  { type: 'tags', label: 'Gerenciar Tags', desc: 'Aplicar/remover tags', icon: Tags, color: '#9fd97a' },
  { type: 'menu', label: 'Menu', desc: 'Menu de N opções', icon: ListTree, color: '#5fb6a6' },
  { type: 'random', label: 'Randomizador', desc: 'Caminho aleatório', icon: Shuffle, color: '#7aa88f' },
  { type: 'action', label: 'Ação Automática', desc: 'Executar ação', icon: Zap, color: '#b7ff59' },
  { type: 'ai', label: 'Inteligência IA', desc: 'Acionar/pausar IA', icon: Bot, color: '#63d3b1' },
  { type: 'webhook', label: 'Webhook', desc: 'Chamada HTTP', icon: Webhook, color: '#6f9488' },
  { type: 'handoff', label: 'Transferir', desc: 'Transferir atendimento', icon: UserRoundCheck, color: '#4fbf8b' },
];

const iconFor = kind => NODE_TYPES.find(item => item.type === kind)?.icon || Workflow;

// Saídas nomeadas: o motor segue a aresta pelo sourceHandle.
function outputsFor(data) {
  const cfg = data.config || {};
  if (data.kind === 'condition') return [['yes', 'Sim'], ['no', 'Não']];
  if (data.kind === 'menu') {
    const options = (cfg.options || []).filter(o => String(o).trim());
    return [...options.map((o, i) => [`opt-${i}`, `${i + 1}`]), ['other', 'Outro']];
  }
  if (data.kind === 'random') return Array.from({ length: Math.max(2, Number(cfg.branches) || 2) }, (_, i) => [`r-${i}`, String.fromCharCode(65 + i)]);
  if (data.kind === 'handoff') return [];
  return null;
}

function AutomationNode({ data, selected }) {
  const Icon = data.kind === 'trigger' ? Radio : iconFor(data.kind);
  const color = data.kind === 'trigger' ? '#b7ff59' : (NODE_TYPES.find(item => item.type === data.kind)?.color || '#6f9488');
  const outputs = outputsFor(data);
  return (
    <div className={`flow-node ${selected ? 'is-selected' : ''}`} style={{ '--node-color': color }}>
      {data.kind !== 'trigger' && <Handle type="target" position={Position.Top} />}
      <div className="flow-node-title"><span className="flow-node-icon"><Icon size={13} /></span>{data.label}</div>
      <div className="flow-node-description">{data.description || 'Configure esta etapa'}</div>
      {outputs === null && <Handle type="source" position={Position.Bottom} />}
      {outputs && outputs.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 6, fontSize: 9, opacity: 0.8 }}>
          {outputs.map(([id, label], i) => (
            <span key={id} style={{ position: 'relative' }}>
              {label}
              <Handle type="source" id={id} position={Position.Bottom}
                style={{ left: '50%', bottom: -10, background: id === 'no' || id === 'other' ? '#f87171' : undefined }} />
            </span>
          ))}
        </div>
      )}
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
  const [agents, setAgents] = useState([]);
  useEffect(() => { api.get('/inbox/meta/options').then(r => setAgents(r.data.agents)).catch(() => {}); }, []);
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

  const [versions, setVersions] = useState(null);
  const [testing, setTesting] = useState(null);
  const [runDetail, setRunDetail] = useState(null);

  // Salvar mexe só no rascunho. Quem está no fluxo segue na versão publicada.
  const save = async (publish = false) => {
    if (!connectionId) return toast.error('Selecione a conexão que executará esta automação');
    setSaving(true);
    try {
      await api.put(`/automations/${automation._id}`, {
        nodes, edges, connection_id: connectionId,
        trigger: { type: 'message', event: 'message_received' },
      });
      if (publish) {
        const changelog = window.prompt('O que mudou nesta versão? (opcional)') ?? '';
        const { data } = await api.post(`/automations/${automation._id}/publish`, { changelog });
        toast.success(data.detail);
        onSaved();
        onClose();
      } else {
        toast.success('Rascunho salvo');
        onSaved();
      }
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const openVersions = async () => {
    try { const { data } = await api.get(`/automations/${automation._id}/versions`); setVersions(data.items); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const restore = async (version) => {
    if (!window.confirm(`Carregar a versão ${version} no rascunho? O rascunho atual será substituído.`)) return;
    try {
      const { data } = await api.post(`/automations/${automation._id}/versions/${version}/restore`);
      setNodes(normalizeNodes(data.nodes));
      setEdges(data.edges || []);
      setVersions(null);
      toast.success(data.detail);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const runTest = async () => {
    try {
      const { data } = await api.post(`/automations/${automation._id}/test`, {
        nodes, edges,
        message: testing.message, player_name: testing.player_name,
        tags: testing.tags.split(',').map(t => t.trim()).filter(Boolean),
        has_ftd: testing.has_ftd,
        replies: testing.replies.split('\n').map(r => r.trim()).filter(Boolean),
      });
      setTesting(t => ({ ...t, result: data }));
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const openRun = async (id) => {
    try { const { data } = await api.get(`/automations/${automation._id}/runs/${id}`); setRunDetail(data); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
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
        <div className="automation-title"><strong>{automation.name}</strong><span>{nodes.length} blocos · {edges.length} conexões · {automation.published ? `v${automation.published.version} publicada` : 'nunca publicada'}</span></div>
        <div className="automation-header-actions">
          <Button variant="ghost" size="sm" onClick={openAnalytics}><BarChart3 size={13} className="mr-2" />Analytics</Button>
          <Button variant="ghost" size="sm" onClick={openExecutions}><ListChecks size={13} className="mr-2" />Execuções</Button>
          <Button variant="ghost" size="sm" onClick={openVersions} data-testid="automation-versions"><History size={13} className="mr-2" />Versões</Button>
          <Button variant="ghost" size="sm" data-testid="automation-test"
            onClick={() => setTesting({ message: 'oi', player_name: 'Lead de teste', tags: '', has_ftd: false, replies: '', result: null })}>
            <FlaskConical size={13} className="mr-2" />Testar
          </Button>
          <Button variant="outline" size="sm" onClick={() => save(false)} disabled={saving}><Save size={13} className="mr-2" />Salvar rascunho</Button>
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
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#15382f" />
            <Controls showInteractive={false} />
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
              {selectedNode.data.kind === 'webhook' && <div className="flow-field"><Label>URL</Label><Input placeholder="https://..." value={selectedNode.data.config?.url || ''} onChange={event => updateConfig('url', event.target.value)} /><small>POST JSON com lead, conversa e última mensagem. Só endereços públicos.</small></div>}
              <NodeConfig node={selectedNode} updateConfig={updateConfig} agents={agents} />
              <Button variant="outline" className="w-full text-destructive" onClick={() => { setNodes(current => current.filter(node => node.id !== selectedNodeId)); setEdges(current => current.filter(edge => edge.source !== selectedNodeId && edge.target !== selectedNodeId)); setSelectedNodeId(null); }}><Trash2 size={13} className="mr-2" />Excluir bloco</Button>
            </div>
          ) : <p className="flow-settings-empty">Selecione um bloco para editar suas propriedades.</p>}
        </aside>
      </div>
      <AutomationAnalyticsDialog open={!!analytics} data={analytics} nodes={nodes} name={automation.name} loading={panelLoading} onClose={() => setAnalytics(null)} onRefresh={openAnalytics} />
      <AutomationExecutionsDialog open={!!executions} data={executions} loading={panelLoading} onClose={() => setExecutions(null)} onRefresh={openExecutions} onOpenRun={openRun} />
      <Dialog open={!!versions} onOpenChange={o => !o && setVersions(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Versões publicadas</DialogTitle></DialogHeader>
          <DialogDescription className="text-xs">Cada publicação é imutável. Restaurar traz a versão para o rascunho; publique para ela voltar a valer.</DialogDescription>
          {versions?.length ? (
            <Table><TableHeader><TableRow><TableHead>Versão</TableHead><TableHead>Publicada</TableHead><TableHead>Por</TableHead><TableHead>O que mudou</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{versions.map(v => (
                <TableRow key={v._id}>
                  <TableCell className="text-xs font-medium">v{v.version}</TableCell>
                  <TableCell className="text-[10px]">{new Date(v.published_at).toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-xs">{v.published_by_name || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.changelog || '—'}</TableCell>
                  <TableCell className="text-right"><Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => restore(v.version)}>Restaurar</Button></TableCell>
                </TableRow>
              ))}</TableBody></Table>
          ) : <p className="text-xs text-muted-foreground">Nenhuma versão publicada ainda.</p>}
        </DialogContent>
      </Dialog>
      <Dialog open={!!testing} onOpenChange={o => !o && setTesting(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Testar fluxo</DialogTitle></DialogHeader>
          <DialogDescription className="text-xs">Simula o rascunho atual. Nada é enviado e nenhum lead é alterado; esperas são puladas.</DialogDescription>
          {testing && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div><Label className="text-xs">Primeira mensagem do lead</Label><Input className="text-xs" value={testing.message} onChange={e => setTesting(t => ({ ...t, message: e.target.value }))} /></div>
                <div><Label className="text-xs">Nome</Label><Input className="text-xs" value={testing.player_name} onChange={e => setTesting(t => ({ ...t, player_name: e.target.value }))} /></div>
                <div><Label className="text-xs">Etiquetas (vírgula)</Label><Input className="text-xs" value={testing.tags} onChange={e => setTesting(t => ({ ...t, tags: e.target.value }))} /></div>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={testing.has_ftd} onChange={e => setTesting(t => ({ ...t, has_ftd: e.target.checked }))} /> Já fez FTD</label>
                <div><Label className="text-xs">Respostas aos menus (uma por linha)</Label><Textarea rows={3} className="text-xs" value={testing.replies} onChange={e => setTesting(t => ({ ...t, replies: e.target.value }))} /></div>
                <Button size="sm" onClick={runTest} data-testid="run-test"><FlaskConical size={13} className="mr-2" />Simular</Button>
              </div>
              <div className="rounded-md border border-border p-2 max-h-80 overflow-auto space-y-1.5" data-testid="test-transcript">
                {!testing.result ? <p className="text-xs text-muted-foreground">O resultado aparece aqui.</p> : (
                  <>
                    {testing.result.problems.length > 0 && <p className="text-[10px] text-amber-300">Não publicável: {testing.result.problems.join('; ')}</p>}
                    {testing.result.transcript.map((step, i) => <TestStep key={i} step={step} />)}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!runDetail} onOpenChange={o => !o && setRunDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Execução · {statusLabel(runDetail?.status)}</DialogTitle></DialogHeader>
          <DialogDescription className="text-xs">{runDetail?.version ? `Versão ${runDetail.version}` : 'Versão anterior ao versionamento'}{runDetail?.error ? ` · erro: ${runDetail.error}` : ''}</DialogDescription>
          <div className="max-h-80 overflow-auto space-y-1">
            {(runDetail?.log || []).length === 0 ? <p className="text-xs text-muted-foreground">Sem passos registrados ainda.</p> : runDetail.log.map((l, i) => (
              <div key={i} className="text-[11px] flex gap-2">
                <span className="text-muted-foreground shrink-0">{new Date(l.at).toLocaleTimeString('pt-BR')}</span>
                <Badge variant="outline" className="text-[9px]">{l.type}</Badge>
                <span className="truncate">{l.node}</span>
                {l.detail && <span className="text-muted-foreground truncate">{l.detail}</span>}
                {l.error && <span className="text-destructive">{l.error}</span>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STEP_TEXT = {
  send: s => `Enviaria: “${s.text}”`,
  wait: s => `Esperaria ${s.minutes} min`,
  reply: s => `Lead respondeu: “${s.text}”`,
  tags: s => `Etiquetas: +${(s.add || []).join(', ') || '—'} / -${(s.remove || []).join(', ') || '—'}`,
  stage: s => `Moveria para a etapa “${s.stage}”`,
  ai_reply: s => `Responderia com IA (instrução: “${s.prompt.slice(0, 60)}”)`,
  webhook: s => `Chamaria ${s.url}`,
  handoff: s => (s.agent_id ? 'Transferiria para um atendente' : 'Devolveria para a fila humana'),
  close_conversation: () => 'Encerraria a conversa',
  reopen_conversation: () => 'Reabriria a conversa',
  log: s => s.text,
  end: s => (s.status === 'completed' ? 'Fim do fluxo' : s.status === 'waiting_reply' ? 'Parou esperando resposta do lead' : `Falhou: ${s.error}`),
};

function TestStep({ step }) {
  const text = (STEP_TEXT[step.type] || (() => step.type))(step);
  const tone = step.type === 'end' && step.status === 'failed' ? 'text-destructive' : step.type === 'send' ? '' : 'text-muted-foreground';
  return <p className={`text-[11px] ${tone} whitespace-pre-wrap`}>{text}</p>;
}

const CONDITION_FIELDS = [['message', 'Mensagem do lead'], ['tag', 'Etiqueta'], ['has_ftd', 'Fez FTD'], ['source', 'Fonte'], ['stage', 'Etapa']];
const CONDITION_OPS = [['contains', 'contém'], ['equals', 'é igual a'], ['not_contains', 'não contém'], ['exists', 'existe'], ['not_exists', 'não existe']];
const listValue = v => (Array.isArray(v) ? v.join(', ') : '');
const toList = v => v.split(',').map(x => x.trim()).filter(Boolean);

function NodeConfig({ node, updateConfig, agents }) {
  const kind = node.data.kind;
  const cfg = node.data.config || {};
  if (kind === 'condition') {
    return <>
      <div className="flow-field"><Label>Campo</Label><Select value={cfg.field || 'message'} onValueChange={v => updateConfig('field', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONDITION_FIELDS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
      <div className="flow-field"><Label>Operador</Label><Select value={cfg.operator || 'contains'} onValueChange={v => updateConfig('operator', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONDITION_OPS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
      {!['exists', 'not_exists'].includes(cfg.operator) && cfg.field !== 'has_ftd' && <div className="flow-field"><Label>Valor</Label><Input value={cfg.value || ''} onChange={e => updateConfig('value', e.target.value)} /></div>}
      <small className="text-[10px] text-muted-foreground">Ligue a saída “Sim” e a “Não”.</small>
    </>;
  }
  if (kind === 'tags') {
    return <>
      <div className="flow-field"><Label>Adicionar (vírgula)</Label><Input value={listValue(cfg.add)} onChange={e => updateConfig('add', toList(e.target.value))} /></div>
      <div className="flow-field"><Label>Remover (vírgula)</Label><Input value={listValue(cfg.remove)} onChange={e => updateConfig('remove', toList(e.target.value))} /></div>
    </>;
  }
  if (kind === 'crm_action') {
    return <div className="flow-field"><Label>Mover para a etapa</Label><Input placeholder="qualificado, negociação…" value={cfg.stage || ''} onChange={e => updateConfig('stage', e.target.value)} /></div>;
  }
  if (kind === 'menu') {
    return <>
      <div className="flow-field"><Label>Pergunta</Label><Textarea rows={2} value={cfg.text || ''} onChange={e => updateConfig('text', e.target.value)} /></div>
      <div className="flow-field"><Label>Opções (uma por linha)</Label><Textarea rows={4} value={(cfg.options || []).join('\n')} onChange={e => updateConfig('options', e.target.value.split('\n'))} /><small>O lead responde com o número ou o texto. Resposta fora das opções segue por “Outro”.</small></div>
    </>;
  }
  if (kind === 'random') {
    return <div className="flow-field"><Label>Caminhos</Label><Input type="number" min="2" max="6" value={cfg.branches || 2} onChange={e => updateConfig('branches', e.target.value)} /><small>Cada caminho tem a mesma chance.</small></div>;
  }
  if (kind === 'action') {
    return <div className="flow-field"><Label>Ação</Label><Select value={cfg.kind || ''} onValueChange={v => updateConfig('kind', v)}><SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger><SelectContent><SelectItem value="close_conversation">Encerrar conversa</SelectItem><SelectItem value="reopen_conversation">Reabrir conversa</SelectItem></SelectContent></Select></div>;
  }
  if (kind === 'ai') {
    return <div className="flow-field"><Label>Instrução para a IA</Label><Textarea rows={5} placeholder="Você é o atendente da operação. Responda de forma curta…" value={cfg.prompt || ''} onChange={e => updateConfig('prompt', e.target.value)} /><small>Responde à última mensagem do lead usando o provedor de Plataforma &gt; IA.</small></div>;
  }
  if (kind === 'handoff') {
    return <div className="flow-field"><Label>Para</Label><Select value={cfg.agent_id || 'queue'} onValueChange={v => updateConfig('agent_id', v === 'queue' ? null : v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="queue">Fila (qualquer atendente)</SelectItem>{agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select><small>O fluxo termina aqui.</small></div>;
  }
  return null;
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
    <div className="automation-data-section"><h4>Últimas execuções — onde cada lead chegou</h4>{data?.recent?.length ? <div className="recent-runs">{data.recent.map(run => <div key={run._id}><Badge variant="outline">{statusLabel(run.status)}</Badge><span>{run.current_node_id || 'Gatilho inicial'}</span><time>{new Date(run.created_at).toLocaleString('pt-BR')}</time></div>)}</div> : <p>Sem execuções registradas ainda.</p>}</div>
  </DialogContent></Dialog>;
}

function AutomationExecutionsDialog({ open, data, loading, onClose, onRefresh, onOpenRun }) {
  return <Dialog open={open} onOpenChange={value => !value && onClose()}><DialogContent className="automation-data-dialog max-w-4xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><ListChecks size={16} />Execuções do fluxo</DialogTitle></DialogHeader>
    <DialogDescription className="sr-only">Lista de leads que entraram neste fluxo e o estado atual de cada execução.</DialogDescription>
    <Button variant="ghost" size="icon" className="dialog-refresh" onClick={onRefresh} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></Button>
    {data?.items?.length ? <div className="executions-table"><Table><TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Status</TableHead><TableHead>Etapa atual</TableHead><TableHead>Início</TableHead></TableRow></TableHeader><TableBody>{data.items.map(run => <TableRow key={run._id} className="cursor-pointer" onClick={() => onOpenRun(run._id)}><TableCell>{run.player_name}</TableCell><TableCell><Badge variant="outline">{statusLabel(run.status)}</Badge></TableCell><TableCell>{run.current_node_id || 'Gatilho inicial'}</TableCell><TableCell>{new Date(run.created_at).toLocaleString('pt-BR')}</TableCell></TableRow>)}</TableBody></Table></div> : <div className="automation-empty-runs"><ListChecks size={28} /><p>Nenhuma execução registrada ainda.</p><span>Ative o fluxo para começar.</span></div>}
    <div className="executions-footnote">Clique em uma linha para ver o log detalhado.</div>
  </DialogContent></Dialog>;
}

const AUTOMATION_STATUS = { draft: 'Rascunho', active: 'Ativa', paused: 'Pausada' };

export default function AutomationsPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
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
      setShowCreate(false); setForm({ name: '', connection_id: '' }); navigate(`/automations/${data._id}`); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro ao criar'); }
  };
  const openEditor = useCallback(async id => { try { const { data } = await api.get(`/automations/${id}`); setShowEditor(data); } catch { toast.error('Automação não encontrada'); navigate('/automations', { replace: true }); } }, [navigate]);
  useEffect(() => { if (routeId) openEditor(routeId); else setShowEditor(null); }, [routeId, openEditor]);
  const toggleStatus = async item => { const status = item.status === 'active' ? 'paused' : 'active'; try { await api.put(`/automations/${item._id}`, { status }); toast.success(status === 'active' ? 'Automação ativada' : 'Automação pausada'); load(); } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); } };
  const remove = async id => { if (!window.confirm('Remover automação?')) return; try { await api.delete(`/automations/${id}`); toast.success('Automação removida'); load(); } catch { toast.error('Erro ao remover'); } };

  if (showEditor) return <ReactFlowProvider><FlowEditor key={showEditor._id} automation={showEditor} connections={connections} onClose={() => navigate('/automations')} onSaved={load} /></ReactFlowProvider>;

  return <div data-testid="automations-page">
    <div className="page-header"><div><h1>Automações<span className="accent">.</span></h1><p className="page-description">Crie jornadas visuais acionadas pelas suas conexões de mensagem.</p></div><Button onClick={() => setShowCreate(true)} data-testid="create-automation-btn"><Plus size={14} className="mr-2" />Nova automação</Button></div>
    <div className="data-toolbar"><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="draft">Rascunho</SelectItem><SelectItem value="active">Ativo</SelectItem><SelectItem value="paused">Pausado</SelectItem></SelectContent></Select><Badge variant="outline" className="text-[9px] ml-auto">{total} automações</Badge></div>
    {items.length === 0 ? (
      <div className="stat-card empty-state"><Workflow size={32} /><h3>Nenhuma automação</h3><p>Crie um fluxo e conecte-o ao WhatsApp ou Telegram.</p></div>
    ) : (
      <div className="automation-grid">
        {items.map(item => (
          <div key={item._id} className="stat-card automation-card" data-testid={`automation-${item._id}`}>
            <div className="automation-card-top">
              <span className={`automation-icon ${item.status === 'active' ? 'is-on' : ''}`}><Workflow size={16} /></span>
              <Badge className={`text-[9px] ${item.status === 'active' ? 'badge-success' : item.status === 'paused' ? 'badge-warning' : ''}`}>{AUTOMATION_STATUS[item.status] || item.status}</Badge>
            </div>
            <button type="button" className="automation-name" onClick={() => navigate(`/automations/${item._id}`)}>{item.name}</button>
            <p className="text-[10px] text-muted-foreground">{connectionNames[item.connection_id] || 'Sem conexão'} · {(item.nodes || []).length} blocos · {(item.edges || []).length} ligações</p>
            <div className="automation-card-foot">
              <span className="text-[9px] text-muted-foreground">{item.executions || 0} execuções</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Editar" onClick={() => navigate(`/automations/${item._id}`)}><Edit size={13} /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={item.status === 'active' ? 'Pausar' : 'Ativar'} onClick={() => toggleStatus(item)}>{item.status === 'active' ? <Pause size={13} /> : <Play size={13} />}</Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Remover" onClick={() => remove(item._id)}><Trash2 size={13} /></Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
    <Dialog open={showCreate} onOpenChange={setShowCreate}><DialogContent data-testid="create-automation-dialog"><DialogHeader><DialogTitle>Nova automação</DialogTitle></DialogHeader><form onSubmit={handleCreate} className="space-y-4"><div><Label>Nome</Label><Input className="mt-1" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ex.: Boas-vindas Telegram" required /></div><div><Label>Conexão</Label><Select value={form.connection_id} onValueChange={value => setForm(current => ({ ...current, connection_id: value }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Selecione WhatsApp ou Telegram" /></SelectTrigger><SelectContent>{connections.map(connection => <SelectItem key={connection._id} value={connection._id}>{connection.name} · {connection.provider}</SelectItem>)}</SelectContent></Select><p className="text-[10px] text-muted-foreground mt-1">Mensagens recebidas nesta conexão iniciarão o fluxo.</p></div>{connections.length === 0 && <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-900 rounded-md p-3">Configure primeiro uma integração de WhatsApp ou Telegram.</div>}<DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" disabled={!connections.length} data-testid="submit-automation">Criar e editar</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
