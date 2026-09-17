import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Sparkles, Send, Square } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL;

/** Lê o corpo SSE do /copilot/chat e entrega cada pedaço de texto. */
async function streamChat(message, { signal, onDelta }) {
  const post = () => fetch(`${API_URL}/api/copilot/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });
  let res = await post();
  // fetch não passa pelo interceptor do axios: renova o token e tenta de novo.
  if (res.status === 401) {
    await api.post('/auth/refresh').catch(() => {});
    res = await post();
  }
  if (!res.ok) {
    let detail = `Erro ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch { /* corpo não-JSON */ }
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Eventos SSE terminam em linha em branco; o último pode estar incompleto.
    const events = buffer.split('\n\n');
    buffer = events.pop();
    for (const event of events) {
      const data = event.replace(/^data: ?/, '');
      if (data === '[DONE]') return;
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.content) onDelta(parsed.content);
    }
  }
}

export default function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    api.get('/copilot/history').then(r => setMessages(r.data.items.map(m => ({ role: m.role, content: m.content })))).catch(() => {});
  }, [open]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);
    setStreaming(true);
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(text, {
        signal: controller.signal,
        onDelta: (delta) => setMessages(m => {
          const next = m.slice();
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        }),
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        // Resposta vazia não fica na conversa como se o copiloto tivesse falado.
        setMessages(m => (m[m.length - 1]?.content ? m : m.slice(0, -1)));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="copilot-btn" aria-label="Copiloto">
          <Sparkles size={16} />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0" data-testid="copilot-panel">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border">
          <SheetTitle className="text-sm">Copiloto TrakAquire</SheetTitle>
          <SheetDescription className="text-[11px]">Sugere, não executa. Toda ação passa pela governança.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground">Pergunte sobre métricas, campanhas ou integrações. Ex.: “Qual fonte teve o menor CPFTD?”</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`text-xs whitespace-pre-wrap rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-muted ml-8' : 'border border-border mr-8'}`}>
              {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
            </div>
          ))}
          {error && <p className="text-xs text-destructive" data-testid="copilot-error">{error}</p>}
          <div ref={endRef} />
        </div>

        <form onSubmit={send} className="border-t border-border p-3 flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
            placeholder="Qual o CPFTD desta semana?"
            className="text-xs min-h-[40px] max-h-32"
            rows={1}
            data-testid="copilot-input"
          />
          {streaming ? (
            <Button type="button" size="icon" variant="outline" onClick={stop} aria-label="Parar"><Square size={14} /></Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Enviar" data-testid="copilot-send"><Send size={14} /></Button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
