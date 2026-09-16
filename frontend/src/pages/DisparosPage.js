import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Send, Plus, Trash2, Calendar, Clock } from 'lucide-react';
import { toast } from 'sonner';

export default function DisparosPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [segments, setSegments] = useState([]);
  const [form, setForm] = useState({ name: '', channel: 'telegram', segment_id: '', content: { text: '' }, scheduled_at: '' });

  const load = useCallback(async () => {
    try {
      const [disp, seg] = await Promise.all([api.get('/disparos'), api.get('/segments')]);
      setItems(disp.data.items); setTotal(disp.data.total); setSegments(seg.data.items);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/disparos', { ...form, content: { text: form.content.text } });
      toast.success('Disparo criado'); setShowCreate(false);
      setForm({ name: '', channel: 'telegram', segment_id: '', content: { text: '' }, scheduled_at: '' }); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover disparo?')) return;
    try { await api.delete(`/disparos/${id}`); toast.success('Removido'); load(); } catch { toast.error('Erro'); }
  };

  const statusColors = { draft: '', scheduled: 'badge-warning', sending: 'badge-info', sent: 'badge-success' };

  return (
    <div data-testid="disparos-page">
      <div className="page-header">
        <div><h1>Disparos<span className="accent">.</span></h1><p className="page-description">Envie mensagens para segmentos por Telegram, SMS ou Voz.</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-dispatch-btn"><Plus size={14} className="mr-2" /> Novo disparo</Button>
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Nome</TableHead>
            <TableHead className="text-xs">Canal</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Alvo</TableHead>
            <TableHead className="text-xs">Enviados</TableHead>
            <TableHead className="text-xs">FTDs</TableHead>
            <TableHead className="text-xs">Agendado</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><Send size={32} /><h3>Nenhum disparo</h3><p>Crie seu primeiro disparo para alcançar seu público.</p></div></TableCell></TableRow>
            ) : items.map(d => (
              <TableRow key={d._id}>
                <TableCell className="text-xs font-medium">{d.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[9px]">{d.channel}</Badge></TableCell>
                <TableCell><Badge className={`text-[9px] ${statusColors[d.status] || ''}`}>{d.status}</Badge></TableCell>
                <TableCell className="text-xs">{d.stats?.target || 0}</TableCell>
                <TableCell className="text-xs">{d.stats?.sent || 0}</TableCell>
                <TableCell className="text-xs">{d.stats?.ftds || 0}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{d.scheduled_at ? new Date(d.scheduled_at).toLocaleString('pt-BR') : 'Imediato'}</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(d._id)}><Trash2 size={13} /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg" data-testid="create-dispatch-dialog">
          <DialogHeader><DialogTitle>Novo disparo</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Canal</Label>
                <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="telegram" className="text-xs">Telegram</SelectItem>
                    <SelectItem value="whatsapp" className="text-xs">WhatsApp</SelectItem>
                    <SelectItem value="sms" className="text-xs">SMS</SelectItem>
                    <SelectItem value="voz" className="text-xs">Voz</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Segmento</Label>
                <Select value={form.segment_id} onValueChange={v => setForm(f => ({ ...f, segment_id: v }))}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                  <SelectContent>
                    {segments.map(s => <SelectItem key={s._id} value={s._id} className="text-xs">{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Mensagem</Label><Textarea className="text-xs mt-1" rows={4} value={form.content.text} onChange={e => setForm(f => ({ ...f, content: { text: e.target.value } }))} placeholder="Olá {primeiro_nome}, ..." required /></div>
            <div><Label className="text-xs">Agendar (opcional)</Label><Input className="text-xs mt-1" type="datetime-local" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} /></div>
            <div className="stat-card p-3 text-[10px] text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Pré-voo</p>
              <p>Público bruto, elegíveis, exclusões e custo serão calculados antes do envio. Contatos suprimidos ou sem opt-in serão excluídos automaticamente.</p>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" data-testid="submit-dispatch">Agendar disparo</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
