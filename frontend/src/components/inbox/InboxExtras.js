import { useCallback, useEffect, useRef, useState } from 'react';
import api, { formatApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag, X, Zap } from 'lucide-react';
import { toast } from 'sonner';

/** Etiquetas da conversa: só o que está cadastrado na workspace. */
export function TagPicker({ tags = [], catalog = [], onChange }) {
  const [open, setOpen] = useState(false);
  const available = catalog.filter(t => !tags.includes(t.name));
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-border" data-testid="conversation-tags">
      <Tag size={11} className="text-muted-foreground" />
      {tags.map(t => (
        <Badge key={t} variant="outline" className="text-[9px] gap-1 pr-1">
          {t}
          <button type="button" aria-label={`Remover etiqueta ${t}`} onClick={() => onChange(tags.filter(x => x !== t))}><X size={9} /></button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground underline" data-testid="add-tag">
            {catalog.length ? 'Adicionar etiqueta' : 'Cadastre etiquetas em Configurações'}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="start">
          {available.length === 0 ? (
            <p className="text-[10px] text-muted-foreground p-2">Nada para adicionar.</p>
          ) : available.map(t => (
            <button key={t._id} type="button" className="block w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
              onClick={() => { onChange([...tags, t.name]); setOpen(false); }}>
              <span className={`tag-dot tag-${t.color}`} />{t.name}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Respostas rápidas da workspace, já com nome/telefone do lead trocados. */
export function QuickReplies({ conversationId, onPick }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => { api.get('/quick-replies').then(r => setItems(r.data.items)).catch(() => {}); }, []);
  const use = async (item) => {
    try {
      const { data } = await api.post(`/quick-replies/${item._id}/render`, { conversation_id: conversationId });
      onPick(data.content);
      setOpen(false);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };
  const filtered = items.filter(i => `${i.title} ${i.shortcut || ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" data-testid="quick-replies-btn">
          <Zap size={11} /> Respostas rápidas
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <Input className="h-7 text-xs mb-2" placeholder="Buscar resposta…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="max-h-56 overflow-auto">
          {filtered.length === 0 ? (
            <p className="text-[10px] text-muted-foreground p-2">Cadastre respostas em Configurações › Respostas rápidas.</p>
          ) : filtered.map(item => (
            <button key={item._id} type="button" className="block w-full text-left px-2 py-1.5 rounded hover:bg-muted" onClick={() => use(item)}>
              <span className="text-xs font-medium">{item.title}</span>
              {item.shortcut && <span className="text-[9px] text-muted-foreground ml-1">/{item.shortcut}</span>}
              <span className="block text-[10px] text-muted-foreground truncate">{item.content}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const TONES = {
  chime: [[880, 0], [1320, 0.12]],
  ping: [[1046, 0]],
  alert: [[660, 0], [660, 0.16], [880, 0.32]],
  pop: [[420, 0]],
};

/** Aviso sonoro de mensagem nova, respeitando o intervalo mínimo do usuário. */
export function useInboxAudio() {
  const [settings, setSettings] = useState(null);
  const last = useRef(0);
  useEffect(() => { api.get('/settings/inbox-audio').then(r => setSettings(r.data)).catch(() => {}); }, []);
  return useCallback(() => {
    if (!settings?.enabled) return;
    const now = Date.now();
    if (now - last.current < (settings.min_interval_seconds || 0) * 1000) return;
    last.current = now;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      (TONES[settings.sound] || TONES.chime).forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = settings.sound === 'pop' ? 'triangle' : 'sine';
        gain.gain.value = (settings.volume ?? 70) / 100 * 0.25;
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.28);
        osc.stop(ctx.currentTime + delay + 0.3);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch { /* navegador sem áudio ou sem permissão */ }
  }, [settings]);
}
