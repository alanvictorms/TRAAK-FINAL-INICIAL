import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell } from 'lucide-react';

const POLL_MS = 60000;

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
};

export default function NotificationsMenu() {
  const navigate = useNavigate();
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.get('/notifications', { params: { limit: 20 } }).then(r => setData(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) {
      setData(d => ({ ...d, unread: Math.max(0, d.unread - 1), items: d.items.map(i => i._id === n._id ? { ...i, read: true } : i) }));
      api.post(`/notifications/${n._id}/read`).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    await api.post('/notifications/mark-read').catch(() => {});
    setData(d => ({ ...d, unread: 0, items: d.items.map(i => ({ ...i, read: true })) }));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="notifications-btn"
          aria-label={data.unread ? `${data.unread} notificações não lidas` : 'Notificações'}>
          <Bell size={16} />
          {data.unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[9px] leading-4 text-white text-center">
              {data.unread > 9 ? '9+' : data.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-medium">Notificações</span>
          {data.unread > 0 && (
            <button type="button" className="text-[10px] text-muted-foreground hover:underline" onClick={markAll} data-testid="mark-all-read">
              Marcar todas como lidas
            </button>
          )}
        </div>
        {data.items.length === 0 ? (
          <p className="text-xs text-muted-foreground px-3 py-6 text-center">Sem notificações.</p>
        ) : (
          <ScrollArea className="max-h-80">
            {data.items.map(n => (
              <button key={n._id} type="button" onClick={() => openItem(n)}
                className={`w-full text-left px-3 py-2 border-b border-border last:border-0 hover:bg-muted/40 ${n.read ? 'opacity-60' : ''}`}
                data-testid={`notification-${n._id}`}>
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{n.title}</div>
                    {n.body && <div className="text-[10px] text-muted-foreground line-clamp-2">{n.body}</div>}
                  </div>
                  <span className="text-[9px] text-muted-foreground shrink-0">{ago(n.created_at)}</span>
                </div>
              </button>
            ))}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
