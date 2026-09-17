import { useEffect, useState } from 'react';
import { statusLabel } from '@/lib/labels';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Search } from 'lucide-react';

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  // Ctrl/Cmd+K abre de qualquer tela.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setGroups([]); return undefined; }
    setLoading(true);
    let stale = false;
    const timer = setTimeout(() => {
      api.get('/search', { params: { q: term } })
        .then(r => { if (!stale) setGroups(r.data.groups); })
        .catch(() => { if (!stale) setGroups([]); })
        .finally(() => { if (!stale) setLoading(false); });
    }, 250);
    // Resposta de uma busca antiga não sobrescreve a atual.
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);

  const go = (link) => {
    setOpen(false);
    setQuery('');
    navigate(link);
  };

  const term = query.trim();

  return (
    <>
      <button type="button" className="topbar-search" onClick={() => setOpen(true)} data-testid="global-search">
        <Search size={14} />
        <span className="text-xs text-muted-foreground">Buscar…</span>
        <kbd className="ml-auto text-[9px] text-muted-foreground border border-border rounded px-1">Ctrl K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Busca global</DialogTitle>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Players, conversas, links, campanhas, automações…"
              value={query}
              onValueChange={setQuery}
              data-testid="global-search-input"
            />
            <CommandList>
              {term.length < 2 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Digite ao menos 2 caracteres.</p>
              ) : loading ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Buscando…</p>
              ) : (
                <CommandEmpty className="py-6 text-center text-xs">Nada encontrado para “{term}”.</CommandEmpty>
              )}
              {!loading && groups.map(g => (
                <CommandGroup key={g.type} heading={g.label}>
                  {g.items.map(item => (
                    <CommandItem key={item.id} value={`${g.type}-${item.id}`} onSelect={() => go(item.link)} className="text-xs">
                      <span className="truncate">{item.title}</span>
                      {item.status && <span className="ml-auto text-[10px] text-muted-foreground">{statusLabel(item.status)}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
