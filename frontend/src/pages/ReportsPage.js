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
import { FileText, Plus, Trash2, Calendar, Download } from 'lucide-react';
import { toast } from 'sonner';

export default function ReportsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'custom', metrics: '', dimensions: '', period: '7d' });

  const load = useCallback(async () => {
    try { const { data } = await api.get('/reports'); setItems(data.items); setTotal(data.total); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/reports', {
        name: form.name, type: form.type, period: form.period,
        metrics: form.metrics ? form.metrics.split(',').map(s => s.trim()) : [],
        dimensions: form.dimensions ? form.dimensions.split(',').map(s => s.trim()) : [],
      });
      toast.success('Relatório criado'); setShowCreate(false);
      setForm({ name: '', type: 'custom', metrics: '', dimensions: '', period: '7d' }); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover relatório?')) return;
    try { await api.delete(`/reports/${id}`); toast.success('Removido'); load(); } catch { toast.error('Erro'); }
  };

  return (
    <div data-testid="reports-page">
      <div className="page-header">
        <div><h1>Relatórios<span className="accent">.</span></h1><p className="page-description">Biblioteca, agendamentos e snapshots.</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-report-btn"><Plus size={14} className="mr-2" /> Novo relatório</Button>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Nome</TableHead>
            <TableHead className="text-xs">Tipo</TableHead>
            <TableHead className="text-xs">Período</TableHead>
            <TableHead className="text-xs">Métricas</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Criado</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><FileText size={32} /><h3>Nenhum relatório</h3><p>Crie relatórios personalizados com métricas e dimensões.</p></div></TableCell></TableRow>
            ) : items.map(r => (
              <TableRow key={r._id}>
                <TableCell className="text-xs font-medium">{r.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[9px]">{r.type}</Badge></TableCell>
                <TableCell className="text-xs">{r.period || '—'}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{(r.metrics || []).join(', ') || '—'}</TableCell>
                <TableCell><Badge className={`text-[9px] ${r.status === 'published' ? 'badge-success' : ''}`}>{r.status}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString('pt-BR')}</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(r._id)}><Trash2 size={13} /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="create-report-dialog">
          <DialogHeader><DialogTitle>Novo relatório</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom" className="text-xs">Personalizado</SelectItem>
                    <SelectItem value="revenue" className="text-xs">Receita</SelectItem>
                    <SelectItem value="acquisition" className="text-xs">Aquisição</SelectItem>
                    <SelectItem value="atendimento" className="text-xs">Atendimento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Período</Label>
                <Select value={form.period} onValueChange={v => setForm(f => ({ ...f, period: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1d" className="text-xs">Hoje</SelectItem>
                    <SelectItem value="7d" className="text-xs">7 dias</SelectItem>
                    <SelectItem value="30d" className="text-xs">30 dias</SelectItem>
                    <SelectItem value="90d" className="text-xs">90 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Métricas (vírgula)</Label><Input className="text-xs mt-1" value={form.metrics} onChange={e => setForm(f => ({ ...f, metrics: e.target.value }))} placeholder="ftds, deposits, spend, cpftd, roi" /></div>
            <div><Label className="text-xs">Dimensões (vírgula)</Label><Input className="text-xs mt-1" value={form.dimensions} onChange={e => setForm(f => ({ ...f, dimensions: e.target.value }))} placeholder="source, campaign, expert" /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" data-testid="submit-report">Criar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
