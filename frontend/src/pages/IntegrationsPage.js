import { useState, useEffect, useCallback } from 'react';
import { statusLabel } from '@/lib/labels';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Search, Radar, Settings, TestTube, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import IntegrationDrawer from '@/components/integrations/IntegrationDrawer';

const PROVIDERS = [
  { id: 'tap', name: 'TAP', category: 'revenue', desc: 'Revenue provider — postback S2S',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'api_secret', label: 'API Secret', type: 'password', required: true },
      { key: 'postback_url', label: 'Postback URL (gerado)', type: 'text', readonly: true, placeholder: 'Gerado após salvar' },
      { key: 'webhook_secret', label: 'Webhook Secret (HMAC)', type: 'password', required: false, hint: 'Para validar assinatura dos postbacks recebidos' },
    ],
    capabilities: ['postback_s2s', 'reporting_api', 'reconciliation_d1'],
    docs: 'Configure credenciais TAP e use o Postback URL gerado para receber eventos de registro, FTD, depósito e saque.'
  },
  { id: 'meta', name: 'Meta Ads', category: 'acquisition', desc: 'Leitura de mídia e CAPI',
    fields: [
      { key: 'app_id', label: 'App ID', type: 'text', required: true },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true },
      { key: 'access_token', label: 'Access Token', type: 'password', required: true },
      { key: 'pixel_id', label: 'Pixel ID', type: 'text', required: true },
      { key: 'ad_account_id', label: 'Ad Account ID', type: 'text', required: true, placeholder: 'act_XXXXXXXXX' },
      { key: 'verify_token', label: 'Webhook Verify Token', type: 'text', required: false },
    ],
    capabilities: ['read_media', 'capi_send', 'cost_sync'],
    docs: 'Conecte sua conta Meta para leitura de campanhas/custos e envio de conversões via CAPI server-side.'
  },
  { id: 'google', name: 'Google Ads', category: 'acquisition', desc: 'Campanhas e conversões',
    fields: [
      { key: 'customer_id', label: 'Customer ID', type: 'text', required: true, placeholder: 'XXX-XXX-XXXX' },
      { key: 'mcc_id', label: 'MCC ID (opcional)', type: 'text' },
      { key: 'developer_token', label: 'Developer Token', type: 'password', required: true },
      { key: 'client_id', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'OAuth Client Secret', type: 'password', required: true },
      { key: 'refresh_token', label: 'Refresh Token', type: 'password', required: true },
    ],
    capabilities: ['read_campaigns', 'read_costs', 'enhanced_conversions'],
    docs: 'Configure OAuth e Developer Token para leitura de campanhas/custos e Enhanced Conversions.'
  },
  { id: 'tiktok', name: 'TikTok', category: 'acquisition', desc: 'Ads e Events API',
    fields: [
      { key: 'app_id', label: 'App ID', type: 'text', required: true },
      { key: 'app_secret', label: 'App Secret', type: 'password', required: true },
      { key: 'access_token', label: 'Access Token', type: 'password', required: true },
      { key: 'pixel_id', label: 'Pixel Code', type: 'text', required: true },
    ],
    capabilities: ['read_ads', 'events_api', 'cost_sync'],
    docs: 'Conecte TikTok for Business para leitura de anúncios e envio de eventos de conversão.'
  },
  { id: 'telegram', name: 'Telegram', category: 'messaging', desc: 'Bot, canais e atendimento',
    fields: [
      { key: 'bot_token', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...' },
      { key: 'webhook_url', label: 'Webhook URL (gerado)', type: 'text', readonly: true },
      { key: 'bot_username', label: 'Username do bot', type: 'text', placeholder: '@meubot' },
    ],
    capabilities: ['send_message', 'receive_updates', 'deep_link', 'channels'],
    docs: 'Crie um bot via @BotFather, cole o token aqui. O webhook será configurado automaticamente.'
  },
  { id: 'whatsapp', name: 'WhatsApp', category: 'messaging', desc: 'Canal de atendimento',
    fields: [
      { key: 'phone_number_id', label: 'Phone Number ID', type: 'text', required: true },
      { key: 'access_token', label: 'Permanent Access Token', type: 'password', required: true },
      { key: 'waba_id', label: 'WhatsApp Business Account ID', type: 'text', required: true },
      { key: 'verify_token', label: 'Webhook Verify Token', type: 'text', required: true },
      { key: 'app_secret', label: 'App Secret (assinatura)', type: 'password', required: false },
    ],
    capabilities: ['send_message', 'receive_message', 'templates'],
    docs: 'Configure via Meta for Developers. Envio condicionado a elegibilidade, opt-in e políticas (MSG-02).'
  },
  { id: 'zenvia_sms', name: 'Zenvia SMS', category: 'messaging', desc: 'Envio por segmentos',
    fields: [
      { key: 'api_token', label: 'API Token', type: 'password', required: true },
      { key: 'sender_id', label: 'Sender ID (remetente)', type: 'text', required: true },
    ],
    capabilities: ['send_sms', 'delivery_receipt'],
    docs: 'Token da API Zenvia para envio de SMS. Preços reais dependem do contrato com a Zenvia.'
  },
  { id: 'zenvia_voz', name: 'Zenvia Voz', category: 'messaging', desc: 'Texto para voz',
    fields: [
      { key: 'api_token', label: 'API Token', type: 'password', required: true },
      { key: 'caller_id', label: 'Caller ID (número)', type: 'text', required: true },
    ],
    capabilities: ['tts_call', 'call_status'],
    docs: 'Chamadas TTS via Zenvia. Custo por duração conforme contrato.'
  },
  { id: 'cloudflare', name: 'Cloudflare', category: 'infra', desc: 'Proxy e tracking',
    fields: [
      { key: 'api_token', label: 'API Token', type: 'password', required: true },
      { key: 'zone_id', label: 'Zone ID', type: 'text', required: true },
      { key: 'account_id', label: 'Account ID', type: 'text', required: true },
    ],
    capabilities: ['dns_proxy', 'ssl', 'workers'],
    docs: 'Proxy/encaminhamento de tracking e postback vinculado aos domínios.'
  },
  { id: 'webhook_out', name: 'Webhooks de saída', category: 'infra', desc: 'Avisa seu sistema a cada evento da plataforma',
    fields: [
      { key: 'callback_url', label: 'URL de callback', type: 'text', required: true, placeholder: 'https://seusistema.com/eventos',
        hint: 'Endereço que o serviço vai chamar quando houver um evento. Cole aqui a URL informada na sua conta.' },
      { key: 'secret', label: 'Segredo para assinar (opcional)', type: 'password', hint: 'Enviamos a assinatura no cabeçalho X-Trak-Signature.' },
      { key: 'api_key', label: 'Token de autorização (opcional)', type: 'password', hint: 'Vai no cabeçalho Authorization: Bearer.' },
    ],
    capabilities: ['event_push', 'hmac_signature', 'retry'],
    docs: 'Enviamos um POST em JSON a cada lead novo, mensagem recebida, cadastro, FTD, depósito, saque e disparo concluído.'
  },
  { id: 'webhook_in', name: 'Webhook de entrada', category: 'infra', desc: 'Recebe eventos de sistemas seus',
    fields: [
      { key: 'source_name', label: 'Nome de quem envia', type: 'text', placeholder: 'ERP, checkout, painel próprio' },
      { key: 'postback_url', label: 'URL para o seu sistema chamar (gerada)', type: 'text', readonly: true, placeholder: 'Gerada após salvar' },
    ],
    capabilities: ['receive_events', 'token_auth'],
    docs: 'Depois de salvar, copie a URL gerada e chame com POST em JSON: event (register, ftd, deposit, withdrawal), customer_id, amount e transaction_id.'
  },
  { id: 'postback', name: 'Postback da casa', category: 'revenue', desc: 'URL de postback para casas sem integração pronta',
    fields: [
      { key: 'house_name', label: 'Nome da casa', type: 'text', required: true },
      { key: 'postback_url', label: 'URL de postback (gerada)', type: 'text', readonly: true, placeholder: 'Gerada após salvar' },
    ],
    capabilities: ['postback_s2s', 'reconciliation'],
    docs: 'Cadastre a URL gerada no painel da casa. Os eventos entram no ledger e na atribuição igual ao TAP.'
  },
  { id: 'openai', name: 'OpenAI', category: 'ia', desc: 'Copiloto e processamento IA',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'model', label: 'Modelo padrão', type: 'text', placeholder: 'gpt-5.4-mini' },
      { key: 'org_id', label: 'Organization ID (opcional)', type: 'text' },
    ],
    capabilities: ['chat', 'embeddings'],
    docs: 'Para o Copiloto. Também configurável em Plataforma > Provedores IA.'
  },
];

const CATEGORY_LABELS = { revenue: 'Receita', acquisition: 'Aquisição', messaging: 'Mensageria', infra: 'Infra', ia: 'IA' };
const STATUS_LABELS = { active: 'Conectado', configured: 'Configurado', connected: 'Conectado', error: 'Com erro', restricted: 'Restrito' };
const statusColors = { active: 'badge-success', configured: 'badge-info', connected: 'badge-info', available: '', error: 'badge-error', restricted: 'badge-warning' };

export default function IntegrationsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  // O detalhe vem do servidor: é lá que integrações TAP antigas ganham token de postback.
  const openDetail = async (item) => {
    setShowDetail(item);
    try { const { data } = await api.get(`/integrations/${item._id}`); setShowDetail(data); } catch { /* fica com o da lista */ }
  };
  const [form, setForm] = useState({ provider: '' });
  const [credFields, setCredFields] = useState({});

  const selectedProvider = PROVIDERS.find(p => p.id === form.provider);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (catFilter !== 'all') params.set('category', catFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const { data } = await api.get(`/integrations?${params}`);
      setItems(data.items);
    } catch (err) {
      toast.error('Erro ao carregar integrações');
    } finally {
      setLoading(false);
    }
  }, [search, catFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const provider = selectedProvider;
    if (!provider) return;
    try {
      // Validate required fields
      const missing = (provider.fields || []).filter(f => f.required && !credFields[f.key]);
      if (missing.length > 0) {
        toast.error(`Preencha: ${missing.map(f => f.label).join(', ')}`);
        return;
      }
      const { data } = await api.post('/integrations', {
        provider: provider.id,
        category: provider.category,
        name: provider.name,
        credentials: credFields,
        config: {},
        capabilities: provider.capabilities || [],
      });
      if (provider.id === 'telegram' && data.webhook_registration?.status !== 'registered') {
        toast.error(`Integração salva, mas o webhook falhou: ${data.webhook_registration?.detail || 'erro desconhecido'}`);
      } else {
        toast.success(provider.id === 'telegram' ? 'Telegram conectado e webhook registrado' : 'Integração criada');
      }
      setShowCreate(false);
      setForm({ provider: '' });
      setCredFields({});
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao criar');
    }
  };

  const handleTest = async (id) => {
    try {
      const { data } = await api.post(`/integrations/${id}/test`);
      toast.success(`Teste: ${data.status}`);
      load();
    } catch (err) {
      toast.error('Erro no teste');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover integração?')) return;
    try {
      await api.delete(`/integrations/${id}`);
      toast.success('Integração removida');
      load();
    } catch (err) {
      toast.error('Erro ao remover');
    }
  };

  const handleRegisterWebhook = async (id) => {
    try {
      await api.post(`/integrations/${id}/webhook/register`);
      toast.success('Webhook registrado no Telegram');
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao registrar webhook');
    }
  };

  return (
    <div data-testid="integrations-page">
      <div className="page-header">
        <div>
          <h1>Integrações<span className="accent">.</span></h1>
          <p className="page-description">Conecte provedores de receita, aquisição, mensageria e infraestrutura.</p>
        </div>
      </div>

      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '32px', height: '32px', fontSize: '11px' }} data-testid="integrations-search" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-category">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="revenue">Revenue</SelectItem>
            <SelectItem value="acquisition">Acquisition</SelectItem>
            <SelectItem value="messaging">Messaging</SelectItem>
            <SelectItem value="infra">Infra</SelectItem>
            <SelectItem value="ia">IA</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativa</SelectItem>
            <SelectItem value="configured">Configurada</SelectItem>
            <SelectItem value="available">Disponível</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="catalog-grid" data-testid="integrations-catalog">
        {PROVIDERS.filter(p => (catFilter === 'all' || p.category === catFilter)
          && `${p.name} ${p.desc}`.toLowerCase().includes(search.toLowerCase())).map(provider => {
          const connected = items.filter(i => i.provider === provider.id);
          if (statusFilter !== 'all' && !connected.some(i => i.status === statusFilter)) return null;
          const first = connected[0];
          return (
            <div key={provider.id} className="stat-card catalog-card" data-testid={`catalog-${provider.id}`}>
              <div className="catalog-card-top">
                <span className={`catalog-icon cat-${provider.category}`}><Radar size={17} /></span>
                <Badge variant="outline" className="catalog-category">{CATEGORY_LABELS[provider.category] || provider.category}</Badge>
              </div>
              <strong className="catalog-name">{provider.name}</strong>
              <p className="catalog-desc">{provider.desc}</p>
              <div className="catalog-card-foot">
                <span className={`catalog-status ${first ? 'is-on' : ''}`}>
                  {first ? `${connected.length > 1 ? `${connected.length} conexões · ` : ''}${STATUS_LABELS[first.status] || first.status}` : 'Não conectado'}
                </span>
                {first ? (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openDetail(first)} data-testid={`config-${first._id}`} aria-label="Configurar"><Settings size={13} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleTest(first._id)} data-testid={`test-${first._id}`} aria-label="Testar"><TestTube size={13} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(first._id)} aria-label="Remover"><Trash2 size={13} /></Button>
                  </div>
                ) : (
                  <Button size="sm" className="h-7 text-[10px]" onClick={() => { setForm({ provider: provider.id }); setCredFields({}); setShowCreate(true); }} data-testid={`connect-${provider.id}`}>
                    Conectar
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg" data-testid="create-integration-dialog">
          <DialogHeader><DialogTitle>Conectar {selectedProvider?.name || 'integração'}</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate}>
            <div className="space-y-4">
              {selectedProvider && (
                <div className="flex items-center gap-2">
                  <span className={`catalog-icon cat-${selectedProvider.category}`}><Radar size={16} /></span>
                  <div><strong className="text-xs block">{selectedProvider.name}</strong>
                    <span className="text-[10px] text-muted-foreground">{selectedProvider.desc}</span></div>
                </div>
              )}
              {selectedProvider && (
                <>
                  {selectedProvider.docs && (
                    <div className="text-[10px] text-muted-foreground bg-muted p-3 rounded-md leading-relaxed">{selectedProvider.docs}</div>
                  )}
                  {(selectedProvider.fields || []).map(field => (
                    <div key={field.key}>
                      <Label className="text-xs">{field.label} {field.required && <span className="text-destructive">*</span>}</Label>
                      <Input
                        className="text-xs mt-1 font-mono"
                        type={field.type === 'password' ? 'password' : 'text'}
                        placeholder={field.placeholder || ''}
                        value={credFields[field.key] || ''}
                        onChange={e => setCredFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                        readOnly={field.readonly}
                        required={field.required}
                        data-testid={`field-${field.key}`}
                      />
                      {field.hint && <p className="text-[9px] text-muted-foreground mt-1">{field.hint}</p>}
                    </div>
                  ))}
                  {selectedProvider.capabilities && (
                    <div>
                      <Label className="text-xs mb-1 block">Capacidades</Label>
                      <div className="flex flex-wrap gap-1">
                        {selectedProvider.capabilities.map(c => (
                          <Badge key={c} variant="outline" className="text-[8px]">{c}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button type="submit" disabled={!form.provider} data-testid="submit-integration">Criar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <IntegrationDrawer
        integration={showDetail}
        provider={PROVIDERS.find(p => p.id === showDetail?.provider)}
        onClose={removed => { setShowDetail(null); if (removed === true) load(); }}
        onChanged={async id => { load(); const { data } = await api.get(`/integrations/${id}`); setShowDetail(data); }}
        onRegisterWebhook={handleRegisterWebhook}
      />

    </div>
  );
}
