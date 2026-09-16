import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, Users, Plus, Eye } from 'lucide-react';
import { toast } from 'sonner';

export default function PlayersPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [originFilter, setOriginFilter] = useState('all');
  const [ftdOnly, setFtdOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({ name: '', origin: '', tags: '' });
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (originFilter !== 'all') params.set('origin', originFilter);
      if (ftdOnly) params.set('ftd_only', 'true');
      const { data } = await api.get(`/players?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch { toast.error('Erro ao carregar players'); }
    finally { setLoading(false); }
  }, [page, search, originFilter, ftdOnly]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (id) => {
    try {
      const { data } = await api.get(`/players/${id}`);
      setShowDetail(data);
    } catch { toast.error('Erro ao carregar player'); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/players', {
        name: form.name,
        origin: form.origin || null,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [],
      });
      toast.success('Player criado');
      setShowCreate(false);
      setForm({ name: '', origin: '', tags: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro');
    }
  };

  return (
    <div data-testid="players-page">
      <div className="page-header">
        <div>
          <h1>Players<span className="accent">.</span></h1>
          <p className="page-description">Pessoas acompanhadas pela operação.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-player-btn">
          <Plus size={14} className="mr-2" /> Novo player
        </Button>
      </div>

      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar por nome ou ID..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '32px', height: '32px', fontSize: '11px' }} data-testid="players-search" />
        </div>
        <Select value={originFilter} onValueChange={v => { setOriginFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Origem" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="meta">Meta</SelectItem>
            <SelectItem value="tiktok">TikTok</SelectItem>
            <SelectItem value="organic">Orgânico</SelectItem>
            <SelectItem value="orphan">Orphan</SelectItem>
          </SelectContent>
        </Select>
        <Button variant={ftdOnly ? 'default' : 'outline'} size="sm" className="text-xs h-8" onClick={() => { setFtdOnly(!ftdOnly); setPage(1); }} data-testid="ftd-filter">
          FTD apenas
        </Button>
        <Badge variant="outline" className="text-[9px] ml-auto">{total} players</Badge>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Nome</TableHead>
              <TableHead className="text-xs">Origem</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">FTD</TableHead>
              <TableHead className="text-xs">Total depósitos</TableHead>
              <TableHead className="text-xs">Tags</TableHead>
              <TableHead className="text-xs text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7}>
                <div className="empty-state">
                  <Users size={32} />
                  <h3>Nenhum player</h3>
                  <p>Players serão criados conforme eventos forem recebidos.</p>
                </div>
              </TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item._id} data-testid={`player-row-${item._id}`}>
                <TableCell className="text-xs font-medium">{item.name || item._id.slice(-8)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.origin || '—'}</TableCell>
                <TableCell><Badge variant="outline" className="text-[9px]">{item.status}</Badge></TableCell>
                <TableCell>{item.has_ftd ? <Badge className="badge-success text-[9px]">Sim</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">{item.total_deposits ? `R$ ${item.total_deposits.toFixed(2)}` : '—'}</TableCell>
                <TableCell className="text-xs">{(item.tags || []).map(t => <Badge key={t} variant="outline" className="text-[8px] mr-1">{t}</Badge>)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadDetail(item._id)} data-testid={`view-player-${item._id}`}><Eye size={13} /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create Player */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-player-dialog">
          <DialogHeader><DialogTitle>Novo player</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label className="text-xs">Origem</Label><Input className="text-xs mt-1" value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} placeholder="meta, tiktok, organic..." /></div>
            <div><Label className="text-xs">Tags (vírgula)</Label><Input className="text-xs mt-1" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="vip, whale..." /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button type="submit" data-testid="submit-player">Criar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Player Detail */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-lg" data-testid="player-detail-dialog">
          <DialogHeader><DialogTitle>{showDetail?.name || 'Player'}</DialogTitle></DialogHeader>
          {showDetail && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-xs"><span className="text-muted-foreground">Origem:</span> {showDetail.origin || '—'}</div>
                <div className="text-xs"><span className="text-muted-foreground">Score:</span> {showDetail.score}</div>
                <div className="text-xs"><span className="text-muted-foreground">FTD:</span> {showDetail.has_ftd ? `Sim — R$ ${showDetail.ftd_value?.toFixed(2) || '0'}` : 'Não'}</div>
                <div className="text-xs"><span className="text-muted-foreground">Total depósitos:</span> R$ {(showDetail.total_deposits || 0).toFixed(2)}</div>
                <div className="text-xs"><span className="text-muted-foreground">Total saques:</span> R$ {(showDetail.total_withdrawals || 0).toFixed(2)}</div>
                <div className="text-xs"><span className="text-muted-foreground">Tags:</span> {(showDetail.tags || []).join(', ') || '—'}</div>
              </div>
              {showDetail.events?.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-2">Eventos ({showDetail.events.length})</p>
                  <div className="space-y-1">
                    {showDetail.events.slice(0, 10).map(ev => (
                      <div key={ev._id} className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-muted">
                        <Badge className={`text-[8px] ${ev.type === 'ftd' ? 'badge-success' : ''}`}>{ev.type}</Badge>
                        <span className="text-muted-foreground">{ev.status}</span>
                        {ev.value && <span>R$ {ev.value.toFixed(2)}</span>}
                        <span className="ml-auto text-muted-foreground">{new Date(ev.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
