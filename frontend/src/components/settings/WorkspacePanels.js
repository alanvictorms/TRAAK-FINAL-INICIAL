import { useCallback, useEffect, useState } from 'react';
import api, { formatApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Plus, Trash2, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

const fail = err => toast.error(formatApiError(err.response?.data?.detail));

export function TagsPanel() {
  const [data, setData] = useState({ items: [], colors: [] });
  const [form, setForm] = useState(null);
  const load = useCallback(() => api.get('/tags').then(r => setData(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form._id) await api.put(`/tags/${form._id}`, form);
      else await api.post('/tags', form);
      toast.success('Etiqueta salva'); setForm(null); load();
    } catch (err) { fail(err); }
  };
  const remove = async (tag) => {
    if (!window.confirm(`Remover a etiqueta “${tag.name}”? Ela sai de todas as conversas e leads.`)) return;
    try { await api.delete(`/tags/${tag._id}`); load(); } catch (err) { fail(err); }
  };

  return (
    <div className="stat-card" style={{ overflow: 'auto' }}>
      <div className="flex items-center justify-between p-3">
        <p className="text-[10px] text-muted-foreground">Só estas etiquetas aparecem no atendimento. Ninguém digita etiqueta solta.</p>
        <Button size="sm" onClick={() => setForm({ name: '', color: data.colors[0] || 'blue', description: '' })} data-testid="create-tag">
          <Plus size={13} className="mr-1" /> Nova etiqueta
        </Button>
      </div>
      <Table>
        <TableHeader><TableRow>{['Etiqueta', 'Descrição', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {data.items.length === 0 && (
            <TableRow><TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-8">Nenhuma etiqueta cadastrada.</TableCell></TableRow>
          )}
          {data.items.map(tag => (
            <TableRow key={tag._id}>
              <TableCell className="text-xs"><button type="button" className="hover:underline" onClick={() => setForm(tag)}><span className={`tag-dot tag-${tag.color}`} />{tag.name}</button></TableCell>
              <TableCell className="text-[10px] text-muted-foreground">{tag.description || '—'}</TableCell>
              <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(tag)}><Trash2 size={13} /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?._id ? 'Editar etiqueta' : 'Nova etiqueta'}</DialogTitle></DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-3">
              <div><Label className="text-xs">Nome</Label><Input required className="text-xs mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <Label className="text-xs">Cor</Label>
                <div className="flex gap-2 mt-1">
                  {data.colors.map(c => (
                    <button key={c} type="button" aria-label={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`tag-swatch tag-${c} ${form.color === c ? 'is-selected' : ''}`} />
                  ))}
                </div>
              </div>
              <div><Label className="text-xs">Descrição</Label><Textarea className="text-xs mt-1" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" data-testid="submit-tag">Salvar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function QuickRepliesPanel() {
  const [data, setData] = useState({ items: [], variables: [] });
  const [form, setForm] = useState(null);
  const load = useCallback(() => api.get('/quick-replies').then(r => setData(r.data)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form._id) await api.put(`/quick-replies/${form._id}`, form);
      else await api.post('/quick-replies', form);
      toast.success('Resposta salva'); setForm(null); load();
    } catch (err) { fail(err); }
  };
  const remove = async (item) => {
    if (!window.confirm(`Remover “${item.title}”?`)) return;
    try { await api.delete(`/quick-replies/${item._id}`); load(); } catch (err) { fail(err); }
  };
  const addVariable = (name) => setForm(f => ({ ...f, content: `${f.content || ''}{{${name}}}` }));

  return (
    <div className="stat-card" style={{ overflow: 'auto' }}>
      <div className="flex items-center justify-between p-3">
        <p className="text-[10px] text-muted-foreground">O atendente escolhe a resposta no chat e as variáveis já vêm preenchidas com os dados do lead.</p>
        <Button size="sm" onClick={() => setForm({ title: '', shortcut: '', content: '' })} data-testid="create-quick-reply">
          <Plus size={13} className="mr-1" /> Nova resposta
        </Button>
      </div>
      <Table>
        <TableHeader><TableRow>{['Título', 'Atalho', 'Texto', ''].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {data.items.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-8">Nenhuma resposta cadastrada.</TableCell></TableRow>
          )}
          {data.items.map(item => (
            <TableRow key={item._id}>
              <TableCell className="text-xs"><button type="button" className="hover:underline" onClick={() => setForm(item)}>{item.title}</button></TableCell>
              <TableCell className="text-[10px] text-muted-foreground">{item.shortcut ? `/${item.shortcut}` : '—'}</TableCell>
              <TableCell className="text-[10px] text-muted-foreground max-w-[380px] truncate">{item.content}</TableCell>
              <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(item)}><Trash2 size={13} /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!form} onOpenChange={o => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?._id ? 'Editar resposta' : 'Nova resposta rápida'}</DialogTitle></DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Título</Label><Input required className="text-xs mt-1" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
                <div><Label className="text-xs">Atalho</Label><Input className="text-xs mt-1" placeholder="boasvindas" value={form.shortcut || ''} onChange={e => setForm(f => ({ ...f, shortcut: e.target.value }))} /></div>
              </div>
              <div>
                <Label className="text-xs">Texto</Label>
                <Textarea required className="text-xs mt-1" rows={5} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
                <div className="flex flex-wrap gap-1 mt-2">
                  {data.variables.map(v => (
                    <button key={v} type="button" className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground" onClick={() => addVariable(v)}>
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" data-testid="submit-quick-reply">Salvar</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AudioPanel() {
  const [settings, setSettings] = useState(null);
  useEffect(() => { api.get('/settings/inbox-audio').then(r => setSettings(r.data)).catch(() => {}); }, []);
  const set = patch => setSettings(s => ({ ...s, ...patch }));

  const play = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = { chime: 880, ping: 1046, alert: 660, pop: 420 }[settings.sound] || 880;
      gain.gain.value = (settings.volume ?? 70) / 100 * 0.25;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.stop(ctx.currentTime + 0.4);
      setTimeout(() => ctx.close(), 800);
    } catch { toast.error('Este navegador não deixou tocar o som'); }
  };
  const save = async () => {
    try { const { data } = await api.put('/settings/inbox-audio', settings); setSettings(data); toast.success('Aviso sonoro salvo'); }
    catch (err) { fail(err); }
  };

  if (!settings) return null;
  return (
    <div className="stat-card p-4 space-y-4 max-w-md">
      <div className="flex items-center justify-between">
        <div><p className="text-xs font-medium">Avisar com som ao chegar mensagem</p><p className="text-[10px] text-muted-foreground">Vale só para você, neste navegador.</p></div>
        <Switch checked={settings.enabled} onCheckedChange={v => set({ enabled: v })} data-testid="audio-enabled" />
      </div>
      <div>
        <Label className="text-xs">Som</Label>
        <Select value={settings.sound} onValueChange={v => set({ sound: v })}>
          <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(settings.sounds || {}).map(([k, l]) => <SelectItem key={k} value={k} className="text-xs">{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Volume ({settings.volume}%)</Label>
        <input type="range" min={0} max={100} value={settings.volume} onChange={e => set({ volume: Number(e.target.value) })} className="w-full mt-1" aria-label="Volume" />
      </div>
      <div>
        <Label className="text-xs">Intervalo mínimo entre avisos (segundos)</Label>
        <Input type="number" min={0} max={300} className="text-xs mt-1" value={settings.min_interval_seconds} onChange={e => set({ min_interval_seconds: Number(e.target.value) })} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={play}><Volume2 size={13} className="mr-1" /> Testar som</Button>
        <Button onClick={save} data-testid="save-audio">Salvar</Button>
      </div>
    </div>
  );
}
