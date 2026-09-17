import { useEffect, useState } from 'react';
import api, { formatApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from 'sonner';

const CHANNELS = [
  ['inapp', 'No app', 'Sino da barra superior'],
  ['email', 'E-mail', 'Para os membros do workspace'],
  ['telegram', 'Telegram', 'Para um chat ou grupo do bot'],
];

const CRITICAL = [
  ['integration_down', 'Integração fora do ar'],
  ['webhook_failures', 'Falhas repetidas de webhook'],
  ['ftd_drop', 'Queda brusca de FTDs'],
  ['budget_exceeded', 'Orçamento de campanha estourado'],
  ['approval_pending', 'Aprovação aguardando decisão'],
];

const DIGEST = [
  ['off', 'Desligado'],
  ['hourly', 'A cada hora'],
  ['daily', 'Diário'],
  ['weekly', 'Semanal'],
];

export default function NotificationsPanel() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/notifications').then(r => setForm(r.data)).catch(() => toast.error('Não foi possível carregar'));
  }, []);

  if (!form) return <p className="text-xs text-muted-foreground mt-4">Carregando…</p>;

  const toggle = (group, key) => setForm(f => ({ ...f, [group]: { ...f[group], [key]: !f[group][key] } }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/settings/notifications', form);
      setForm(data);
      toast.success('Notificações salvas');
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg" data-testid="notifications-panel">
      <div className="stat-card space-y-3">
        <div className="text-sm font-medium">Canais</div>
        {CHANNELS.map(([key, label, hint]) => (
          <div key={key} className="flex items-center justify-between">
            <div><div className="text-xs">{label}</div><div className="text-[10px] text-muted-foreground">{hint}</div></div>
            <Switch checked={form.channels[key]} onCheckedChange={() => toggle('channels', key)} data-testid={`channel-${key}`} />
          </div>
        ))}
        {form.channels.telegram && (
          <div>
            <Label className="text-xs">Chat ID do Telegram</Label>
            <Input className="text-xs mt-1 font-mono" value={form.telegram_chat_id}
              onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))} placeholder="-1001234567890" />
          </div>
        )}
      </div>

      <div className="stat-card space-y-3">
        <div className="text-sm font-medium">Alertas críticos</div>
        <p className="text-[10px] text-muted-foreground">Disparados na hora, em todos os canais ativos.</p>
        {CRITICAL.map(([key, label]) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-xs">{label}</span>
            <Switch checked={form.critical[key]} onCheckedChange={() => toggle('critical', key)} data-testid={`critical-${key}`} />
          </div>
        ))}
      </div>

      <div className="stat-card">
        <Label className="text-xs">Resumo periódico</Label>
        <Select value={form.digest} onValueChange={v => setForm(f => ({ ...f, digest: v }))}>
          <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DIGEST.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Button size="sm" onClick={save} disabled={saving} data-testid="save-notifications-btn">
        {saving ? 'Salvando…' : 'Salvar notificações'}
      </Button>
    </div>
  );
}
