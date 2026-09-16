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
import { Search, Target, Plus, Trash2, Users, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const OPERATORS = ['sim', 'não', 'maior_que', 'menor_que', 'entre', 'igual', 'contém'];
const FIELDS = ['has_ftd', 'origin', 'total_deposits', 'total_withdrawals', 'days_since_click', 'has_telegram', 'has_phone', 'registered'];
const PRESETS = [
  { name: 'Clicou e não depositou', conditions: { has_ftd: { op: 'igual', value: false } }, logic: 'and' },
  { name: 'VIP com telefone', conditions: { total_deposits: { op: 'maior_que', value: 1000 } }, logic: 'and' },
  { name: 'Órfãos depositantes', conditions: { origin: { op: 'igual', value: 'orphan' }, has_ftd: { op: 'igual', value: true } }, logic: 'and' },
  { name: 'Sacou mais que depositou', conditions: { net_negative: { op: 'igual', value: true } }, logic: 'and' },
];

export default function SegmentsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', logic: 'and', conditions: [{ field: 'has_ftd', operator: 'igual', value: 'true' }] });
  const [previewCount, setPreviewCount] = useState(null);

  const load = useCallback(async () => {
    try { const { data } = await api.get('/segments'); setItems(data.items); setTotal(data.total); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const addCondition = () => setForm(f => ({ ...f, conditions: [...f.conditions, { field: 'origin', operator: 'igual', value: '' }] }));
  const removeCondition = (i) => setForm(f => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }));
  const updateCondition = (i, key, val) => setForm(f => ({ ...f, conditions: f.conditions.map((c, idx) => idx === i ? { ...c, [key]: val } : c) }));

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const condObj = {};
      form.conditions.forEach(c => { condObj[c.field] = { op: c.operator, value: c.value }; });
      await api.post('/segments', { name: form.name, logic: form.logic, conditions: condObj });
      toast.success('Segmento criado');
      setShowCreate(false); setForm({ name: '', logic: 'and', conditions: [{ field: 'has_ftd', operator: 'igual', value: 'true' }] }); load();
    } catch (err) { toast.error(err.response?.data?.detail || 'Erro'); }
  };

  const applyPreset = (preset) => {
    const conds = Object.entries(preset.conditions).map(([field, c]) => ({ field, operator: c.op, value: String(c.value) }));
    setForm({ name: preset.name, logic: preset.logic, conditions: conds });
    setShowCreate(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover segmento?')) return;
    try { await api.delete(`/segments/${id}`); toast.success('Removido'); load(); } catch { toast.error('Erro'); }
  };

  return (
    <div data-testid="segments-page">
      <div className="page-header">
        <div><h1>Segmentos<span className="accent">.</span></h1><p className="page-description">Defina públicos com condições E/OU e use em disparos e automações.</p></div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-segment-btn"><Plus size={14} className="mr-2" /> Novo segmento</Button>
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {PRESETS.map(p => (
          <Button key={p.name} variant="outline" size="sm" className="text-[10px] h-7" onClick={() => applyPreset(p)} data-testid={`preset-${p.name}`}>{p.name}</Button>
        ))}
      </div>

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-xs">Nome</TableHead>
            <TableHead className="text-xs">Lógica</TableHead>
            <TableHead className="text-xs">Condições</TableHead>
            <TableHead className="text-xs">Público</TableHead>
            <TableHead className="text-xs">Última avaliação</TableHead>
            <TableHead className="text-xs text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={6}><div className="empty-state"><Target size={32} /><h3>Nenhum segmento</h3><p>Crie segmentos para organizar seu público.</p></div></TableCell></TableRow>
            ) : items.map(s => (
              <TableRow key={s._id}>
                <TableCell className="text-xs font-medium">{s.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[9px]">{s.logic?.toUpperCase()}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{Object.keys(s.conditions || {}).length} regras</TableCell>
                <TableCell className="text-xs">{s.count ?? '—'}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{s.last_evaluated ? new Date(s.last_evaluated).toLocaleString('pt-BR') : 'Nunca'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s._id)}><Trash2 size={13} /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg" data-testid="create-segment-dialog">
          <DialogHeader><DialogTitle>Criar segmento</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label className="text-xs">Nome</Label><Input className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label className="text-xs">Lógica</Label>
              <Select value={form.logic} onValueChange={v => setForm(f => ({ ...f, logic: v }))}>
                <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="and" className="text-xs">E (todas as condições)</SelectItem>
                  <SelectItem value="or" className="text-xs">OU (qualquer condição)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Condições</Label>
              {form.conditions.map((c, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <Select value={c.field} onValueChange={v => updateCondition(i, 'field', v)}>
                    <SelectTrigger className="text-[10px] h-8 w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{FIELDS.map(f => <SelectItem key={f} value={f} className="text-[10px]">{f}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={c.operator} onValueChange={v => updateCondition(i, 'operator', v)}>
                    <SelectTrigger className="text-[10px] h-8 w-[110px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{OPERATORS.map(o => <SelectItem key={o} value={o} className="text-[10px]">{o}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input className="text-[10px] h-8 flex-1" value={c.value} onChange={e => updateCondition(i, 'value', e.target.value)} placeholder="valor" />
                  {form.conditions.length > 1 && <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeCondition(i)}><Trash2 size={11} /></Button>}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="text-[10px] h-7" onClick={addCondition}><Plus size={11} className="mr-1" /> Condição</Button>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" data-testid="submit-segment">Criar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
