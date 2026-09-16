import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Search, Activity, Plus, Eye } from 'lucide-react';
import { toast } from 'sonner';

const typeColors = { click: 'badge-info', register: 'badge-info', ftd: 'badge-success', deposit: 'badge-success', withdrawal: 'badge-warning' };
const statusColors = { captured: '', linked: 'badge-info', confirmed: 'badge-success', reconciled: 'badge-success', divergent: 'badge-warning', failed: 'badge-error', orphan: 'badge-warning' };

export default function LedgerPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({ type: 'click', person_id: '', source: '', value: '', external_id: '', metadata: '{}' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const { data } = await api.get(`/ledger?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch { toast.error('Erro ao carregar ledger'); }
    finally { setLoading(false); }
  }, [page, search, typeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      let meta = {};
      try { meta = JSON.parse(form.metadata); } catch {}
      await api.post('/ledger', {
        type: form.type,
        person_id: form.person_id || null,
        source: form.source || null,
        value: form.value ? parseFloat(form.value) : null,
        external_id: form.external_id || null,
        metadata: meta,
      });
      toast.success('Evento registrado');
      setShowCreate(false);
      setForm({ type: 'click', person_id: '', source: '', value: '', external_id: '', metadata: '{}' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro');
    }
  };

  return (
    <div data-testid="ledger-page">
      <div className="page-header">
        <div>
          <h1>Signal Ledger<span className="accent">.</span></h1>
          <p className="page-description">Sinais, estados e evidências de atribuição.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-event-btn">
          <Plus size={14} className="mr-2" /> Registrar evento
        </Button>
      </div>

      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar por ID ou pessoa..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '32px', height: '32px', fontSize: '11px' }} data-testid="ledger-search" />
        </div>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="click">Click</SelectItem>
            <SelectItem value="register">Register</SelectItem>
            <SelectItem value="ftd">FTD</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdrawal">Withdrawal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="captured">Captured</SelectItem>
            <SelectItem value="linked">Linked</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="reconciled">Reconciled</SelectItem>
            <SelectItem value="divergent">Divergent</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="orphan">Orphan</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[9px] ml-auto">{total} eventos</Badge>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">ID</TableHead>
              <TableHead className="text-xs">Tipo</TableHead>
              <TableHead className="text-xs">Pessoa</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Valor</TableHead>
              <TableHead className="text-xs">Timestamp</TableHead>
              <TableHead className="text-xs text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7}>
                <div className="empty-state">
                  <Activity size={32} />
                  <h3>Nenhum evento</h3>
                  <p>Eventos aparecerão aqui conforme sinais forem capturados.</p>
                </div>
              </TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item._id} data-testid={`event-row-${item._id}`}>
                <TableCell className="text-[10px] font-mono text-muted-foreground">{item._id?.slice(-8)}</TableCell>
                <TableCell><Badge className={`text-[9px] ${typeColors[item.type] || ''}`}>{item.type}</Badge></TableCell>
                <TableCell className="text-xs">{item.person_id ? item.person_id.slice(-8) : '—'}</TableCell>
                <TableCell><Badge className={`text-[9px] ${statusColors[item.status] || ''}`}>{item.status}</Badge></TableCell>
                <TableCell className="text-xs">{item.value != null ? `R$ ${item.value.toFixed(2)}` : '—'}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString('pt-BR')}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowDetail(item)}><Eye size={13} /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
          <span className="text-xs text-muted-foreground self-center">Página {page}</span>
          <Button variant="outline" size="sm" disabled={items.length < 50} onClick={() => setPage(p => p + 1)}>Próxima</Button>
        </div>
      )}

      {/* Create Event */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-event-dialog">
          <DialogHeader><DialogTitle>Registrar evento</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['click', 'register', 'ftd', 'deposit', 'withdrawal'].map(t => (
                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">ID da pessoa (opcional)</Label><Input className="text-xs mt-1" value={form.person_id} onChange={e => setForm(f => ({ ...f, person_id: e.target.value }))} /></div>
            <div><Label className="text-xs">Fonte</Label><Input className="text-xs mt-1" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="meta, tiktok, organic..." /></div>
            <div><Label className="text-xs">Valor</Label><Input className="text-xs mt-1" type="number" step="0.01" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></div>
            <div><Label className="text-xs">ID externo</Label><Input className="text-xs mt-1" value={form.external_id} onChange={e => setForm(f => ({ ...f, external_id: e.target.value }))} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button type="submit" data-testid="submit-event">Registrar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Event Detail */}
      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent data-testid="event-detail-dialog">
          <DialogHeader><DialogTitle>Evento {showDetail?._id?.slice(-8)}</DialogTitle></DialogHeader>
          {showDetail && (
            <div className="space-y-2 text-xs">
              <div><span className="text-muted-foreground">Tipo:</span> {showDetail.type}</div>
              <div><span className="text-muted-foreground">Status:</span> {showDetail.status}</div>
              <div><span className="text-muted-foreground">Pessoa:</span> {showDetail.person_id || 'Não vinculado'}</div>
              <div><span className="text-muted-foreground">Fonte:</span> {showDetail.source || '—'}</div>
              <div><span className="text-muted-foreground">Valor:</span> {showDetail.value != null ? `R$ ${showDetail.value.toFixed(2)}` : '—'}</div>
              <div><span className="text-muted-foreground">ID externo:</span> {showDetail.external_id || '—'}</div>
              <div><span className="text-muted-foreground">Recebido:</span> {new Date(showDetail.received_at || showDetail.created_at).toLocaleString('pt-BR')}</div>
              {showDetail.metadata && Object.keys(showDetail.metadata).length > 0 && (
                <div>
                  <span className="text-muted-foreground">Payload:</span>
                  <pre className="bg-muted p-2 rounded mt-1 text-[10px] overflow-auto">{JSON.stringify(showDetail.metadata, null, 2)}</pre>
                </div>
              )}
              {showDetail.attempts && (
                <div>
                  <span className="text-muted-foreground">Tentativas:</span>
                  <pre className="bg-muted p-2 rounded mt-1 text-[10px] overflow-auto">{JSON.stringify(showDetail.attempts, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
