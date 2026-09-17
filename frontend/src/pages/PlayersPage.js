import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { formatApiError } from '@/lib/api';
import { money } from '@/lib/utils';
import PlayerDetail from '@/components/players/PlayerDetail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, Users, Plus } from 'lucide-react';
import { toast } from 'sonner';

const SOURCE_LABELS = { meta: 'Meta Ads', tiktok: 'TikTok Ads', google: 'Google Ads', kwai: 'Kwai Ads', direct: 'Sem atribuição' };

export default function PlayersPage() {
  const { id } = useParams();
  if (id) return <PlayerDetail key={id} id={id} />;
  return <PlayerList />;
}

function PlayerList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [ftdOnly, setFtdOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', origin: '', tags: '' });
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (ftdOnly) params.set('ftd_only', 'true');
      const { data } = await api.get(`/players?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch { toast.error('Erro ao carregar players'); }
    finally { setLoading(false); }
  }, [page, search, sourceFilter, ftdOnly]);

  useEffect(() => { load(); }, [load]);

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
      toast.error(formatApiError(err.response?.data?.detail));
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
        <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="players-source"><SelectValue placeholder="Fonte" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todas as fontes</SelectItem>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
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
              <TableHead className="text-xs">Fonte</TableHead>
              <TableHead className="text-xs">Entrou via</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">FTD</TableHead>
              <TableHead className="text-xs">Total depósitos</TableHead>
              <TableHead className="text-xs">Tags</TableHead>
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
              <TableRow key={item._id} data-testid={`player-row-${item._id}`} className="cursor-pointer" onClick={() => navigate(`/players/${item._id}`)}>
                <TableCell className="text-xs font-medium">{item.name || item._id.slice(-8)}</TableCell>
                <TableCell className="text-xs">{item.source ? (SOURCE_LABELS[item.source] || item.source) : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.origin || '—'}</TableCell>
                <TableCell><Badge variant="outline" className="text-[9px]">{item.status}</Badge></TableCell>
                <TableCell>{item.has_ftd ? <Badge className="badge-success text-[9px]">Sim</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">{item.total_deposits ? money(item.total_deposits) : '—'}</TableCell>
                <TableCell className="text-xs">{(item.tags || []).map(t => <Badge key={t} variant="outline" className="text-[8px] mr-1">{t}</Badge>)}</TableCell>
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

    </div>
  );
}
