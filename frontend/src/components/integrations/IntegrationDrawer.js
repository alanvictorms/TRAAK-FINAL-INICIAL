import { useEffect, useState } from 'react';
import api, { formatApiError } from '@/lib/api';
import { statusLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Copy, RefreshCw, TestTube, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const CAPABILITIES = {
  send_message: 'Envia mensagens', receive_message: 'Recebe mensagens', receive_updates: 'Recebe mensagens e atualizações',
  deep_link: 'Link com rastreio no início da conversa', channels: 'Acompanha entradas no canal', templates: 'Modelos aprovados',
  postback_s2s: 'Postback servidor a servidor', reporting_api: 'Relatórios da casa', reconciliation_d1: 'Conciliação diária',
  reconciliation: 'Conciliação de valores', read_media: 'Lê campanhas e criativos', capi_send: 'Envia conversões para a Meta',
  cost_sync: 'Traz o investimento das campanhas', read_campaigns: 'Lê campanhas', read_costs: 'Lê o investimento',
  enhanced_conversions: 'Conversões aprimoradas', read_ads: 'Lê anúncios', events_api: 'Envia eventos de conversão',
  send_sms: 'Envia SMS', delivery_receipt: 'Confirma entrega', tts_call: 'Liga com voz sintetizada', call_status: 'Status das chamadas',
  dns_proxy: 'Proxy de DNS', ssl: 'Certificado SSL', workers: 'Execução na borda',
  chat: 'Conversas com IA', embeddings: 'Busca por significado',
  event_push: 'Avisa seu sistema a cada evento', hmac_signature: 'Assinatura para conferir a origem', retry: 'Tenta de novo quando falha',
  receive_events: 'Recebe eventos de fora', token_auth: 'Autenticação por token',
};

const STATUS_STYLE = { active: 'badge-success', configured: 'badge-info', connected: 'badge-info', error: 'badge-error', restricted: 'badge-warning' };
const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast.success('Copiado'), () => toast.error('Não deu para copiar'));

function Address({ title, url, hint, children, testid }) {
  if (!url) return null;
  return (
    <div className="dns-record">
      <div className="dns-record-head">
        <span className="text-[10px] font-medium">{title}</span>
        <button type="button" onClick={() => copy(url)} aria-label={`Copiar ${title}`}><Copy size={11} /></button>
      </div>
      <code className="text-[9px] font-mono break-all block" data-testid={testid}>{url}</code>
      {hint && <p className="text-[9px] text-muted-foreground mt-1">{hint}</p>}
      {children}
    </div>
  );
}

export default function IntegrationDrawer({ integration, provider, onClose, onChanged, onRegisterWebhook }) {
  const [creds, setCreds] = useState({});
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(integration?.name || '');
  useEffect(() => { setCreds({}); setName(integration?.name || ''); }, [integration]);
  if (!integration) return null;

  const config = integration.config || {};
  const masked = integration.credentials_masked || {};
  const editable = (provider?.fields || []).filter(f => !f.readonly);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/integrations/${integration._id}`, { name, credentials: creds });
      toast.success('Integração atualizada');
      setCreds({});
      await onChanged(integration._id);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    setSaving(false);
  };

  const test = async () => {
    try {
      const { data } = await api.post(`/integrations/${integration._id}/test`);
      toast[data.status === 'success' ? 'success' : 'error'](`Teste: ${statusLabel(data.status)}`);
      await onChanged(integration._id);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const remove = async () => {
    if (!window.confirm(`Remover a integração ${integration.name}?`)) return;
    try { await api.delete(`/integrations/${integration._id}`); toast.success('Integração removida'); onClose(true); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="integration-drawer">
        <SheetHeader><SheetTitle className="text-base">{integration.name}</SheetTitle></SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="drawer-summary">
            <div><span>Situação</span><Badge className={`text-[9px] ${STATUS_STYLE[integration.status] || ''}`}>{statusLabel(integration.status)}</Badge></div>
            <div><span>Tipo</span><strong>{provider?.desc || integration.category}</strong></div>
            <div><span>Conectada em</span><strong>{new Date(integration.created_at).toLocaleDateString('pt-BR')}</strong></div>
            <div><span>Último teste</span><strong>{integration.last_test ? statusLabel(integration.last_test.status) : 'nunca'}</strong></div>
          </div>

          {integration.webhook_error && (
            <p className="text-[10px] text-destructive border border-destructive/30 rounded-md p-2">Erro no webhook: {integration.webhook_error}</p>
          )}
          {provider?.docs && <p className="text-[10px] text-muted-foreground">{provider.docs}</p>}

          <section>
            <p className="drawer-label">Credenciais</p>
            <div className="space-y-2">
              <div>
                <Label className="text-[10px]">Nome da conexão</Label>
                <Input className="text-xs mt-1 h-8" value={name} onChange={e => setName(e.target.value)} />
              </div>
              {editable.map(field => (
                <div key={field.key}>
                  <Label className="text-[10px]">{field.label}</Label>
                  <Input className="text-xs mt-1 h-8 font-mono" type={field.type === 'password' ? 'password' : 'text'}
                    value={creds[field.key] ?? ''} data-testid={`cred-${field.key}`}
                    placeholder={masked[field.key] ? 'guardado — digite para trocar' : field.placeholder || ''}
                    onChange={e => setCreds(c => ({ ...c, [field.key]: e.target.value }))} />
                  {field.hint && <p className="text-[9px] text-muted-foreground mt-0.5">{field.hint}</p>}
                </div>
              ))}
              <p className="text-[9px] text-muted-foreground">Campo em branco mantém o valor guardado. Nada é mostrado de volta.</p>
              <Button size="sm" className="w-full" onClick={save} disabled={saving} data-testid="save-integration">
                {saving ? 'Salvando…' : 'Salvar credenciais'}
              </Button>
            </div>
          </section>

          {(config.postback_url || config.webhook_url || config.capi_url) && (
            <section>
              <p className="drawer-label">Endereços desta integração</p>
              <Address title="URL de postback" url={config.postback_url} testid="tap-postback-url"
                hint="Exclusiva desta integração: o token dentro dela autentica cada chamada. Não compartilhe." />
              <Address title="URL do webhook" url={config.webhook_url}
                hint={integration.provider === 'telegram' ? 'Em grupos, desative o Privacy Mode no @BotFather para o bot receber mensagens comuns.' : null}>
                {integration.provider === 'telegram' && (
                  <Button size="sm" variant="outline" className="mt-2 text-[10px] h-7" onClick={() => onRegisterWebhook(integration._id)}>
                    <RefreshCw size={11} className="mr-1" /> Registrar no Telegram
                  </Button>
                )}
              </Address>
              <Address title="Endpoint CAPI" url={config.capi_url} hint="Conversões enviadas por aqui vão para a Meta e ficam no Signal Ledger." />
            </section>
          )}

          <section>
            <p className="drawer-label">O que esta integração faz</p>
            <ul className="capability-list">
              {(integration.capabilities || provider?.capabilities || []).map(c => (
                <li key={c}>{CAPABILITIES[c] || c.replace(/_/g, ' ')}</li>
              ))}
              {(integration.capabilities || provider?.capabilities || []).length === 0 && (
                <li className="text-muted-foreground">Nenhuma capacidade registrada.</li>
              )}
            </ul>
          </section>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 text-[10px]" onClick={test} data-testid="test-integration">
              <TestTube size={12} className="mr-1" /> Testar conexão
            </Button>
            <Button variant="outline" size="sm" className="text-[10px] text-destructive" onClick={remove} aria-label="Remover">
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
