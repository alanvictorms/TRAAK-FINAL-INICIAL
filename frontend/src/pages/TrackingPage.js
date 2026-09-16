import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Search, Link2, Plus, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function TrackingPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', destination: '', utm_source: '', utm_medium: '', utm_campaign: '' });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const { data } = await api.get(`/tracking?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch { toast.error('Erro ao carregar links'); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/tracking', form);
      toast.success('Link criado');
      setShowCreate(false);
      setForm({ name: '', slug: '', destination: '', utm_source: '', utm_medium: '', utm_campaign: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover link?')) return;
    try { await api.delete(`/tracking/${id}`); toast.success('Removido'); load(); } catch { toast.error('Erro'); }
  };

  const copyUrl = (item) => {
    const url = `https://${item.domain_id || 'trk.example.com'}/${item.slug}`;
    navigator.clipboard.writeText(url);
    toast.success('URL copiada');
  };

  return (
    <div data-testid="tracking-page">
      <div className="page-header">
        <div>
          <h1>Links de tracking<span className="accent">.</span></h1>
          <p className="page-description">Crie e gerencie links com UTMs, A/B e regras.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-link-btn"><Plus size={14} className="mr-2" /> Criar link</Button>
      </div>

      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, height: 32, fontSize: 11 }} data-testid="tracking-search" />
        </div>
        <Badge variant="outline" className="text-[9px] ml-auto">{total} links</Badge>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Nome</TableHead>
              <TableHead className="text-xs">Slug</TableHead>
              <TableHead className="text-xs">Destino</TableHead>
              <TableHead className="text-xs">UTM Source</TableHead>
              <TableHead className="text-xs">Cliques</TableHead>
              <TableHead className="text-xs">FTDs</TableHead>
              <TableHead className="text-xs text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><Link2 size={32} /><h3>Nenhum link</h3><p>Crie seu primeiro link de tracking.</p></div></TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item._id}>
                <TableCell className="text-xs font-medium">{item.name}</TableCell>
                <TableCell className="text-[10px] font-mono text-primary">/{item.slug}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground max-w-[200px] truncate">{item.destination}</TableCell>
                <TableCell className="text-xs">{item.utm_source || '—'}</TableCell>
                <TableCell className="text-xs">{item.clicks || 0}</TableCell>
                <TableCell className="text-xs">{item.ftds || 0}</TableCell>
                <TableCell className="text-right">
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyUrl(item)}><Copy size={13} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(item._id)}><Trash2 size={13} /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-link-dialog">
          <DialogHeader><DialogTitle>Criar link de tracking</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label className="text-xs">Slug</Label><Input className="text-xs mt-1" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} required placeholder="meu-link" /></div>
            <div><Label className="text-xs">Destino (URL)</Label><Input className="text-xs mt-1" type="url" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} required placeholder="https://..." /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">utm_source</Label><Input className="text-xs mt-1" value={form.utm_source} onChange={e => setForm(f => ({ ...f, utm_source: e.target.value }))} placeholder="meta" /></div>
              <div><Label className="text-xs">utm_medium</Label><Input className="text-xs mt-1" value={form.utm_medium} onChange={e => setForm(f => ({ ...f, utm_medium: e.target.value }))} placeholder="cpc" /></div>
              <div><Label className="text-xs">utm_campaign</Label><Input className="text-xs mt-1" value={form.utm_campaign} onChange={e => setForm(f => ({ ...f, utm_campaign: e.target.value }))} /></div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" data-testid="submit-link">Criar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
