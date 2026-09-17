import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import LeadDetailsPanel from '@/components/LeadDetailsPanel';
import { QuickReplies, TagPicker, useInboxAudio } from '@/components/inbox/InboxExtras';
import { MessageSquare, Send, User, Clock, Radio, PanelRightOpen, Lock, ArrowRightLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = {
  queue: ['Na fila', 'badge-warning'],
  active: ['Em atendimento', 'badge-info'],
  resolved: ['Encerrada', 'badge-success'],
};

export default function InboxPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [detail, setDetail] = useState(null);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('reply');
  const [search, setSearch] = useState('');
  const [realtime, setRealtime] = useState('connecting');
  const [showLeadPanel, setShowLeadPanel] = useState(false);
  const [tagCatalog, setTagCatalog] = useState([]);
  const playAlert = useInboxAudio();
  const [options, setOptions] = useState({ agents: [], close_reasons: [] });
  const [transfer, setTransfer] = useState(null);
  const [closing, setClosing] = useState(null);
  const selected = routeId || null;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const { data } = await api.get(`/inbox?${params}`);
      setConversations(data.items);
    } catch { toast.error('Erro ao carregar conversas'); }
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/inbox/meta/options').then(r => setOptions(r.data)).catch(() => {}); }, []);
  useEffect(() => { api.get('/tags').then(r => setTagCatalog(r.data.items)).catch(() => {}); }, []);

  const fetchConversation = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/inbox/${id}`);
      setDetail(data);
    } catch {
      toast.error('Conversa não encontrada');
      navigate('/inbox', { replace: true });
    }
  }, [navigate]);

  // A URL manda: /inbox/:id abre a conversa (é para lá que as notificações apontam).
  useEffect(() => {
    if (selected) fetchConversation(selected);
    else setDetail(null);
  }, [selected, fetchConversation]);

  useEffect(() => {
    const stream = new EventSource(`${api.defaults.baseURL}/inbox/events`, { withCredentials: true });
    stream.addEventListener('connected', () => setRealtime('connected'));
    stream.addEventListener('inbox', event => {
      setRealtime('connected');
      load();
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'message.received') playAlert();
        if (selected && payload.conversation_id === selected) fetchConversation(selected);
      } catch { /* evento sem JSON */ }
    });
    stream.onerror = () => setRealtime('reconnecting');
    return () => stream.close();
  }, [load, selected, fetchConversation, playAlert]);

  const open = (id) => navigate(`/inbox/${id}`);

  const sendSuggestion = async (content) => {
    try {
      await api.post(`/inbox/${selected}/messages`, { content, type: 'reply' });
      fetchConversation(selected);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim() || !selected) return;
    try {
      await api.post(`/inbox/${selected}/messages`, { content: message, type: mode });
      setMessage('');
      fetchConversation(selected);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const assumeConversation = async () => {
    try {
      await api.post(`/inbox/${selected}/assign`);
      toast.success('Conversa assumida');
      fetchConversation(selected);
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const confirmTransfer = async () => {
    try {
      const { data } = await api.post(`/inbox/${selected}/assign`, { user_id: transfer.userId, note: transfer.note });
      toast.success(`${data.detail}: ${data.assigned_name}`);
      setTransfer(null);
      fetchConversation(selected);
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const confirmClose = async () => {
    try {
      await api.post(`/inbox/${selected}/close`, { reason: closing.reason, note: closing.note });
      toast.success('Conversa encerrada');
      setClosing(null);
      navigate('/inbox');
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const saveTags = async (tags) => {
    setDetail(d => ({ ...d, tags }));
    try {
      const { data } = await api.put(`/inbox/${selected}/tags`, { tags });
      setDetail(d => ({ ...d, tags: data.tags }));
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      fetchConversation(selected);
    }
  };

  const openClose = () => setClosing({ reason: options.close_reasons[0]?.key || 'other', note: '' });
  const others = options.agents.filter(a => a.id !== detail?.assigned_to);

  return (
    <div data-testid="inbox-page" className="inbox-workspace">
      <div className="inbox-conversation-list">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[10px] font-medium">Conversas</span>
          <span className={`text-[9px] flex items-center gap-1 ${realtime === 'connected' ? 'text-emerald-400' : 'text-amber-400'}`}><Radio size={10} />{realtime === 'connected' ? 'Tempo real' : 'Reconectando'}</span>
        </div>
        <Input placeholder="Buscar conversa..." value={search} onChange={e => setSearch(e.target.value)} className="text-xs h-8 mb-2" data-testid="inbox-search" />
        <ScrollArea className="flex-1 stat-card p-0">
          {conversations.length === 0 ? (
            <div className="empty-state" style={{ minHeight: 200 }}>
              <MessageSquare size={28} />
              <h3 className="text-sm">Sem conversas</h3>
            </div>
          ) : conversations.map(conv => {
            const [label, cls] = STATUS[conv.status] || [conv.status, ''];
            return (
              <button
                type="button"
                key={conv._id}
                onClick={() => open(conv._id)}
                className={`block w-full text-left p-3 border-b border-border transition-colors hover:bg-muted/50 ${selected === conv._id ? 'bg-muted' : ''}`}
                data-testid={`conv-${conv._id}`}
              >
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-xs font-medium truncate">{conv.player_name || 'Sem nome'}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {conv.unread_count > 0 && <Badge className="text-[8px] min-w-5 justify-center">{conv.unread_count}</Badge>}
                    <Badge className={`text-[8px] ${cls}`}>{label}</Badge>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{conv.last_message || conv.subject || 'Nova conversa'}</p>
                {conv.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">{conv.tags.slice(0, 3).map(t => <span key={t} className="text-[8px] text-muted-foreground border border-border rounded px-1">{t}</span>)}</div>
                )}
                <div className="flex items-center gap-1 mt-1 text-[9px] text-muted-foreground">
                  <Clock size={9} />
                  {new Date(conv.updated_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  {conv.assigned_name && <span className="truncate">· {conv.assigned_name}</span>}
                  <span className="ml-auto capitalize">{conv.channel}</span>
                </div>
              </button>
            );
          })}
        </ScrollArea>
      </div>

      <div className="stat-card inbox-chat-area">
        {!detail ? (
          <div className="empty-state flex-1">
            <MessageSquare size={36} />
            <h3>Selecione uma conversa</h3>
            <p>Escolha uma conversa ao lado para visualizar mensagens.</p>
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{detail.player_name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {detail.channel} · {(STATUS[detail.status] || [detail.status])[0]}
                  {detail.assigned_name && ` · com ${detail.assigned_name}`}
                </div>
              </div>
              {detail.status === 'queue' && <Button size="sm" className="text-xs h-7" onClick={assumeConversation} data-testid="assume-btn">Assumir</Button>}
              {detail.status !== 'resolved' && others.length > 0 && (
                <Button size="sm" variant="outline" className="text-xs h-7" data-testid="transfer-btn"
                  onClick={() => setTransfer({ userId: others[0].id, note: '' })}>
                  <ArrowRightLeft size={12} className="mr-1" /> Transferir
                </Button>
              )}
              {detail.status !== 'resolved' && <Button size="sm" variant="outline" className="text-xs h-7" onClick={openClose} data-testid="close-conv-btn">Encerrar</Button>}
              <Button size="icon" variant={showLeadPanel ? 'secondary' : 'ghost'} className="h-8 w-8" onClick={() => setShowLeadPanel(v => !v)} aria-label="Mostrar painel de detalhes" title="Mostrar painel de detalhes"><PanelRightOpen size={14} /></Button>
            </div>

            <TagPicker tags={detail.tags || []} catalog={tagCatalog} onChange={saveTags} />

            <ScrollArea className="flex-1 p-3">
              <div className="space-y-3">
                {(detail.messages || []).map(msg => {
                  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  if (msg.type === 'system') {
                    return <p key={msg._id} className="text-center text-[10px] text-muted-foreground">{msg.content} · {time}</p>;
                  }
                  if (msg.type === 'ai_agent' && msg.suggestion) {
                    return (
                      <div key={msg._id} className="ai-suggestion" data-testid="ai-suggestion">
                        <div className="ai-suggestion-head"><Sparkles size={11} /> Sugestão da IA · {msg.sender_name} · {time}</div>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" className="h-6 text-[10px]" onClick={() => sendSuggestion(msg.content)} data-testid="send-suggestion">Enviar</Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setMessage(msg.content)}>Editar antes</Button>
                        </div>
                      </div>
                    );
                  }
                  if (msg.direction === 'internal') {
                    return (
                      <div key={msg._id} className="rounded-lg px-3 py-2 border border-dashed" data-testid="internal-note"
                        style={{ borderColor: 'hsl(42 65% 55% / .6)', background: 'hsl(42 65% 50% / .08)' }}>
                        <div className="text-[10px] mb-0.5 flex items-center gap-1" style={{ color: 'hsl(42 65% 65%)' }}>
                          <Lock size={10} /> Nota interna · {msg.sender_name || 'Equipe'} · {time}
                        </div>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    );
                  }
                  const outbound = msg.direction === 'outbound' || msg.type === 'reply';
                  return (
                    <div key={msg._id} className={`flex gap-2 ${outbound ? 'justify-end' : ''}`}>
                      <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                        <User size={10} />
                      </div>
                      <div className={`min-w-0 max-w-[75%] rounded-lg px-3 py-2 ${outbound ? 'bg-primary/10 border border-primary/20' : 'bg-muted/60'}`}>
                        <div className="text-[10px] text-muted-foreground mb-0.5">{msg.sender_name || 'Sistema'} · {time}</div>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <form onSubmit={sendMessage} className="p-3 border-t border-border space-y-2"
              style={mode === 'internal_note' ? { background: 'hsl(42 65% 50% / .06)' } : undefined}>
              <div className="flex gap-1" role="tablist" aria-label="Tipo de mensagem">
                {[['reply', 'Responder'], ['internal_note', 'Nota interna']].map(([v, l]) => (
                  <button key={v} type="button" role="tab" aria-selected={mode === v} onClick={() => setMode(v)}
                    className={`text-[10px] px-2 py-0.5 rounded ${mode === v ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
                    data-testid={`mode-${v}`}>
                    {v === 'internal_note' && <Lock size={9} className="inline mr-1" />}{l}
                  </button>
                ))}
                {mode === 'internal_note' && <span className="text-[10px] text-muted-foreground ml-auto self-center">visível só para a equipe</span>}
                {mode === 'reply' && <span className="ml-auto"><QuickReplies conversationId={selected} onPick={text => setMessage(m => (m ? `${m} ${text}` : text))} /></span>}
              </div>
              <div className="flex gap-2">
                <Textarea className="text-xs flex-1 min-h-[36px] max-h-[80px]" rows={1} value={message} onChange={e => setMessage(e.target.value)}
                  placeholder={mode === 'reply' ? 'Responder ao lead…' : 'Escrever nota para a equipe…'} data-testid="message-input" />
                <Button type="submit" size="icon" className="h-9 w-9 self-end" disabled={!message.trim()} data-testid="send-message-btn"
                  aria-label={mode === 'reply' ? 'Enviar resposta' : 'Salvar nota'}><Send size={14} /></Button>
              </div>
            </form>
          </>
        )}
      </div>
      {detail?.lead && showLeadPanel && <LeadDetailsPanel conversation={detail} onRefresh={() => fetchConversation(selected)} onArchive={openClose} onClose={() => setShowLeadPanel(false)} />}

      <Dialog open={!!transfer} onOpenChange={o => { if (!o) setTransfer(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transferir conversa</DialogTitle></DialogHeader>
          {transfer && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Para</Label>
                <Select value={transfer.userId} onValueChange={v => setTransfer(t => ({ ...t, userId: v }))}>
                  <SelectTrigger className="text-xs mt-1" data-testid="transfer-target"><SelectValue /></SelectTrigger>
                  <SelectContent>{others.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}{a.role ? ` · ${a.role}` : ''}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Contexto para quem recebe (opcional)</Label>
                <Textarea className="text-xs mt-1" rows={2} value={transfer.note} onChange={e => setTransfer(t => ({ ...t, note: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransfer(null)}>Cancelar</Button>
            <Button onClick={confirmTransfer} data-testid="confirm-transfer">Transferir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!closing} onOpenChange={o => { if (!o) setClosing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Encerrar conversa</DialogTitle></DialogHeader>
          {closing && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Motivo</Label>
                <Select value={closing.reason} onValueChange={v => setClosing(c => ({ ...c, reason: v }))}>
                  <SelectTrigger className="text-xs mt-1" data-testid="close-reason"><SelectValue /></SelectTrigger>
                  <SelectContent>{options.close_reasons.map(r => <SelectItem key={r.key} value={r.key} className="text-xs">{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Observação (opcional)</Label>
                <Textarea className="text-xs mt-1" rows={2} value={closing.note} onChange={e => setClosing(c => ({ ...c, note: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>Cancelar</Button>
            <Button onClick={confirmClose} data-testid="confirm-close">Encerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
