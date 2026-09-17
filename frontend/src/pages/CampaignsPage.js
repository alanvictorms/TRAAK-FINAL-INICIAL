import { useState, useEffect, useCallback } from 'react';
import { statusLabel } from '@/lib/labels';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Megaphone, Plus, Trash2, Eye } from 'lucide-react';
import { toast } from 'sonner';

export default function CampaignsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', platform: 'meta', budget: '', expert_id: '' });

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (platformFilter !== 'all') p.set('platform', platformFilter);
      const { data } = await api.get(`/media?${p}`);
      setItems(data.items); setTotal(data.total);
    } catch {}
  }, [search, platformFilter]);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/media', { ...form, budget: form.budget ? parseFloat(form.budget) : null });
      toast.success('Campanha criada'); setShowCreate(false);
      setForm({ name: '', platform: 'meta', budget: '', expert_id: '' }); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover campanha?')) return;
    try { await api.delete(`/media/${id}`); toast.success('Removida'); load(); } catch { toast.error('Erro'); }
  };

  return (
    <div data-testid="campaigns-page">
      <div className="page-header">
        <div><h1>Campanhas<span className="accent">.</span></h1><p className="page-description">Campanhas, conjuntos, anúncios e métricas de mídia.</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-campaign-btn"><Plus size={14} className="mr-2" /> Nova campanha</Button>
      </div>
      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, height: 32, fontSize: 11 }} />
        </div>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Plataforma" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Todas</SelectItem>
            <SelectItem value="meta" className="text-xs">Meta Ads</SelectItem>
            <SelectItem value="tiktok" className="text-xs">TikTok</SelectItem>
            <SelectItem value="google" className="text-xs">Google Ads</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[9px] ml-auto">{total} campanhas</Badge>
      </div>
      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Nome</TableHead>
            <TableHead className="text-xs">Plataforma</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Orçamento</TableHead>
            <TableHead className="text-xs">Gasto</TableHead>
            <TableHead className="text-xs">Cliques</TableHead>
            <TableHead className="text-xs">FTDs</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><Megaphone size={32} /><h3>Nenhuma campanha</h3><p>Campanhas serão sincronizadas das integrações ou criadas manualmente.</p></div></TableCell></TableRow>
            ) : items.map(c => (
              <TableRow key={c._id}>
                <TableCell className="text-xs font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[9px]">{c.platform}</Badge></TableCell>
                <TableCell><Badge className={`text-[9px] ${c.status === 'active' ? 'badge-success' : c.status === 'paused' ? 'badge-warning' : ''}`}>{statusLabel(c.status)}</Badge></TableCell>
                <TableCell className="text-xs">{c.budget ? `R$ ${c.budget.toFixed(2)}` : '—'}</TableCell>
                <TableCell className="text-xs">R$ {(c.metrics?.spend || 0).toFixed(2)}</TableCell>
                <TableCell className="text-xs">{c.metrics?.clicks || 0}</TableCell>
                <TableCell className="text-xs">{c.metrics?.ftds || 0}</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(c._id)}><Trash2 size={13} /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-campaign-dialog">
          <DialogHeader><DialogTitle>Nova campanha</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Plataforma</Label>
                <Select value={form.platform} onValueChange={v => setForm(f => ({ ...f, platform: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta" className="text-xs">Meta Ads</SelectItem>
                    <SelectItem value="tiktok" className="text-xs">TikTok Ads</SelectItem>
                    <SelectItem value="google" className="text-xs">Google Ads</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Orçamento (R$)</Label><Input className="text-xs mt-1" type="number" step="0.01" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" data-testid="submit-campaign">Criar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
