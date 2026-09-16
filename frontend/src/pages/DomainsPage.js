import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Search, Globe, Plus, Trash2, CheckCircle2, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function DomainsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [form, setForm] = useState({ domain: '', purpose: 'tracking' });

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      const { data } = await api.get(`/domains?${p}`);
      setItems(data.items); setTotal(data.total);
    } catch {}
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/domains', form);
      toast.success('Domínio adicionado');
      setShowCreate(false); setForm({ domain: '', purpose: 'tracking' }); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover domínio?')) return;
    try { await api.delete(`/domains/${id}`); toast.success('Removido'); load(); } catch { toast.error('Erro'); }
  };

  const loadDetail = async (id) => {
    try { const { data } = await api.get(`/domains/${id}`); setShowDetail(data); } catch {}
  };

  const sslIcon = (s) => s === 'valid' ? <CheckCircle2 size={12} className="text-primary" /> : s === 'pending' ? <Clock size={12} className="text-yellow-500" /> : <AlertTriangle size={12} className="text-destructive" />;

  return (
    <div data-testid="domains-page">
      <div className="page-header">
        <div><h1>Domínios<span className="accent">.</span></h1><p className="page-description">Domínios de presell e tracking com saúde DNS/SSL.</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-domain-btn"><Plus size={14} className="mr-2" /> Adicionar domínio</Button>
      </div>
      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, height: 32, fontSize: 11 }} />
        </div>
        <Badge variant="outline" className="text-[9px] ml-auto">{total} domínios</Badge>
      </div>
      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Domínio</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">SSL</TableHead>
            <TableHead className="text-xs">Finalidade</TableHead>
            <TableHead className="text-xs">Último check</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={6}><div className="empty-state"><Globe size={32} /><h3>Nenhum domínio</h3><p>Adicione seu primeiro domínio de tracking.</p></div></TableCell></TableRow>
            ) : items.map(d => (
              <TableRow key={d._id}>
                <TableCell className="text-xs font-medium">{d.domain}</TableCell>
                <TableCell><Badge className={`text-[9px] ${d.status === 'active' ? 'badge-success' : d.status === 'pending_dns' ? 'badge-warning' : ''}`}>{d.status}</Badge></TableCell>
                <TableCell className="flex items-center gap-1">{sslIcon(d.ssl_status)} <span className="text-[10px]">{d.ssl_status}</span></TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.purpose}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{d.last_check ? new Date(d.last_check).toLocaleString('pt-BR') : '—'}</TableCell>
                <TableCell className="text-right">
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadDetail(d._id)}><RefreshCw size={13} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(d._id)}><Trash2 size={13} /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent><DialogHeader><DialogTitle>Adicionar domínio</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Domínio</Label><Input className="text-xs mt-1" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} required placeholder="trk.meusite.com" /></div>
            <div><Label className="text-xs">Finalidade</Label>
              <Select value={form.purpose} onValueChange={v => setForm(f => ({ ...f, purpose: v }))}>
                <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tracking" className="text-xs">Tracking</SelectItem>
                  <SelectItem value="presell" className="text-xs">Presell</SelectItem>
                  <SelectItem value="postback" className="text-xs">Postback</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit">Adicionar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{showDetail?.domain}</DialogTitle></DialogHeader>
          {showDetail && (
            <Tabs defaultValue="dns">
              <TabsList className="w-full">
                <TabsTrigger value="dns" className="text-xs flex-1">DNS</TabsTrigger>
                <TabsTrigger value="ssl" className="text-xs flex-1">SSL</TabsTrigger>
                <TabsTrigger value="health" className="text-xs flex-1">Health check</TabsTrigger>
                <TabsTrigger value="history" className="text-xs flex-1">Histórico</TabsTrigger>
              </TabsList>
              <TabsContent value="dns" className="mt-3 space-y-2">
                <div className="text-xs"><span className="text-muted-foreground">Status:</span> <Badge className={`text-[9px] ${showDetail.status === 'active' ? 'badge-success' : 'badge-warning'}`}>{showDetail.status}</Badge></div>
                <div className="stat-card p-3">
                  <p className="text-[10px] text-muted-foreground mb-2">Registros DNS necessários:</p>
                  <div className="text-[10px] font-mono bg-muted p-2 rounded">
                    <div>CNAME {showDetail.domain} → trk.trakaquire.com</div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="ssl" className="mt-3 space-y-2">
                <div className="text-xs"><span className="text-muted-foreground">Certificado:</span> {showDetail.ssl_status}</div>
                <p className="text-[10px] text-muted-foreground">O certificado será provisionado automaticamente após a verificação DNS.</p>
              </TabsContent>
              <TabsContent value="health" className="mt-3">
                <p className="text-[10px] text-muted-foreground">Health checks serão executados periodicamente após a ativação do domínio.</p>
              </TabsContent>
              <TabsContent value="history" className="mt-3">
                <p className="text-[10px] text-muted-foreground">Criado em {new Date(showDetail.created_at).toLocaleString('pt-BR')}</p>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
