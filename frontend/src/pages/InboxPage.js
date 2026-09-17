import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import LeadDetailsPanel from '@/components/LeadDetailsPanel';
import { MessageSquare, Send, User, Clock, Radio, PanelRightOpen } from 'lucide-react';
import { toast } from 'sonner';

export default function InboxPage() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [realtime, setRealtime] = useState('connecting');
  const [showLeadPanel, setShowLeadPanel] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const { data } = await api.get(`/inbox?${params}`);
      setConversations(data.items);
    } catch { toast.error('Erro ao carregar conversas'); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const stream = new EventSource(`${api.defaults.baseURL}/inbox/events`, { withCredentials: true });
    stream.addEventListener('connected', () => setRealtime('connected'));
    stream.addEventListener('inbox', event => {
      setRealtime('connected');
      load();
      try {
        const payload = JSON.parse(event.data);
        if (selected && payload.conversation_id === selected) loadConversation(selected);
      } catch {}
    });
    stream.onerror = () => setRealtime('reconnecting');
    return () => stream.close();
  }, [load, selected]);

  const loadConversation = async (id) => {
    try {
      const { data } = await api.get(`/inbox/${id}`);
      setDetail(data);
      setSelected(id);
      setShowLeadPanel(true);
    } catch { toast.error('Erro ao abrir conversa'); }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim() || !selected) return;
    try {
      await api.post(`/inbox/${selected}/messages`, { content: message, type: 'reply' });
      setMessage('');
      loadConversation(selected);
    } catch { toast.error('Erro ao enviar'); }
  };

  const assumeConversation = async () => {
    if (!selected) return;
    try {
      await api.post(`/inbox/${selected}/assign`);
      toast.success('Conversa assumida');
      loadConversation(selected);
      load();
    } catch { toast.error('Erro'); }
  };

  const closeConversation = async () => {
    if (!selected) return;
    try {
      await api.post(`/inbox/${selected}/close`);
      toast.success('Conversa encerrada');
      setSelected(null);
      setDetail(null);
      load();
    } catch { toast.error('Erro'); }
  };

  const statusColors = { queue: 'badge-warning', active: 'badge-info', resolved: 'badge-success' };

  return (
    <div data-testid="inbox-page" className="inbox-workspace">
      {/* Conversation List */}
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
          ) : conversations.map(conv => (
            <div
              key={conv._id}
              onClick={() => loadConversation(conv._id)}
              className={`p-3 cursor-pointer border-b border-border transition-colors hover:bg-muted/50 ${selected === conv._id ? 'bg-muted' : ''}`}
              data-testid={`conv-${conv._id}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium truncate">{conv.player_name || 'Sem nome'}</span>
                <div className="flex items-center gap-1">{conv.unread_count > 0 && <Badge className="text-[8px] min-w-5 justify-center">{conv.unread_count}</Badge>}<Badge className={`text-[8px] ${statusColors[conv.status] || ''}`}>{conv.status}</Badge></div>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{conv.last_message || conv.subject || 'Nova conversa'}</p>
              <div className="flex items-center gap-1 mt-1 text-[9px] text-muted-foreground">
                <Clock size={9} />
                {new Date(conv.updated_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                <span className="ml-auto capitalize">{conv.channel}</span>
              </div>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Conversation Detail */}
      <div className="stat-card inbox-chat-area">
        {!detail ? (
          <div className="empty-state flex-1">
            <MessageSquare size={36} />
            <h3>Selecione uma conversa</h3>
            <p>Escolha uma conversa ao lado para visualizar mensagens.</p>
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-border flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{detail.player_name}</div>
                <div className="text-[10px] text-muted-foreground">{detail.channel} · {detail.status}</div>
              </div>
              {detail.status === 'queue' && <Button size="sm" className="text-xs h-7" onClick={assumeConversation} data-testid="assume-btn">Assumir</Button>}
              {detail.status !== 'resolved' && <Button size="sm" variant="outline" className="text-xs h-7" onClick={closeConversation} data-testid="close-conv-btn">Encerrar</Button>}
              <Button size="icon" variant={showLeadPanel ? 'secondary' : 'ghost'} className="h-8 w-8" onClick={() => setShowLeadPanel(value => !value)} aria-label="Mostrar painel de detalhes" title="Mostrar painel de detalhes"><PanelRightOpen size={14} /></Button>
            </div>
            <ScrollArea className="flex-1 p-3">
              <div className="space-y-3">
                {(detail.messages || []).map(msg => (
                  <div key={msg._id} className={`flex gap-2 ${msg.type === 'internal_note' ? 'opacity-70' : ''} ${msg.direction === 'outbound' || msg.type === 'reply' ? 'justify-end' : ''}`}>
                    <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                      <User size={10} />
                    </div>
                    <div className={`min-w-0 max-w-[75%] rounded-lg px-3 py-2 ${msg.direction === 'outbound' || msg.type === 'reply' ? 'bg-primary/10 border border-primary/20' : 'bg-muted/60'}`}>
                      <div className="text-[10px] text-muted-foreground mb-0.5">
                        {msg.sender_name || 'Sistema'} · {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {msg.type === 'internal_note' && <Badge className="text-[7px] ml-1 badge-warning">Nota interna</Badge>}
                      </div>
                      <p className="text-xs leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <form onSubmit={sendMessage} className="p-3 border-t border-border flex gap-2">
              <Textarea className="text-xs flex-1 min-h-[36px] max-h-[80px]" placeholder="Responder..." value={message} onChange={e => setMessage(e.target.value)} data-testid="message-input" rows={1} />
              <Button type="submit" size="icon" className="h-9 w-9 self-end" disabled={!message.trim()} data-testid="send-message-btn"><Send size={14} /></Button>
            </form>
          </>
        )}
      </div>
      {detail?.lead && showLeadPanel && <LeadDetailsPanel conversation={detail} onRefresh={() => loadConversation(selected)} onArchive={closeConversation} onClose={() => setShowLeadPanel(false)} />}
    </div>
  );
}
