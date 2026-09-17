import { useState, useEffect, useCallback } from 'react';
import api, { formatApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Search, Globe, Plus, Trash2, CheckCircle2, AlertTriangle, Clock, RefreshCw, Copy, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STYLE = { active: 'badge-success', dns_ok: 'badge-info', pending_dns: 'badge-warning', error: 'badge-error' };
const PURPOSES = [['tracking', 'Rastreamento'], ['presell', 'Presell'], ['postback', 'Postback']];
const when = value => (value ? new Date(value).toLocaleString('pt-BR') : 'nunca verificado');

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast.success('Copiado'), () => toast.error('Não deu para copiar'));
}

function DomainDrawer({ domain, onClose, onVerify, verifying }) {
  if (!domain) return null;
  return (
    <Sheet open onOpenChange={o => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="domain-drawer">
        <SheetHeader><SheetTitle className="text-base">{domain.domain}</SheetTitle></SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="drawer-summary">
            <div><span>Situação</span><Badge className={`text-[9px] ${STATUS_STYLE[domain.status] || ''}`}>{domain.status_label}</Badge></div>
            <div><span>Certificado</span><Badge variant="outline" className="text-[9px]">{domain.ssl_label}</Badge></div>
            <div><span>Uso</span><strong>{domain.purpose_label}</strong></div>
            <div><span>Links usando</span><strong>{domain.links ?? 0}</strong></div>
          </div>

          <p className="text-[10px] text-muted-foreground">{domain.last_check_detail || 'Ainda não verificamos este domínio.'}</p>
          <Button size="sm" className="w-full" onClick={onVerify} disabled={verifying} data-testid="verify-domain">
            <RefreshCw size={13} className="mr-1" /> {verifying ? 'Verificando…' : 'Verificar agora'}
          </Button>

          <section>
            <p className="drawer-label">Registros para criar no seu provedor de DNS</p>
            {(domain.records || []).map(record => (
              <div key={record.type} className="dns-record">
                <div className="dns-record-head">
                  <Badge variant="outline" className="text-[8px]">{record.type}</Badge>
                  <button type="button" onClick={() => copy(record.value)} aria-label="Copiar valor"><Copy size={11} /></button>
                </div>
                <p className="dns-line"><span>Nome</span><code>{record.name}</code></p>
                <p className="dns-line"><span>Valor</span><code>{record.value}</code></p>
                <p className="text-[9px] text-muted-foreground mt-1">{record.hint}</p>
              </div>
            ))}
          </section>

          <section>
            <p className="drawer-label">Certificado HTTPS</p>
            <p className="text-[10px] text-muted-foreground">
              {domain.status === 'active'
                ? 'Certificado ativo: o domínio já responde por HTTPS.'
                : 'O certificado é emitido sozinho assim que o DNS estiver apontado para nós.'}
            </p>
          </section>

          <section>
            <p className="drawer-label">Verificações recentes</p>
            {(domain.checks || []).length === 0 && <p className="text-[10px] text-muted-foreground">Nenhuma verificação ainda.</p>}
            {(domain.checks || []).map(check => (
              <div key={check._id} className="domain-check">
                <span className={check.status === 'active' ? 'text-emerald-400' : 'text-amber-400'}>
                  {check.status === 'active' ? <ShieldCheck size={11} /> : <Clock size={11} />}
                </span>
                <div>
                  <p className="text-[10px]">{check.detail}</p>
                  <small className="text-[9px] text-muted-foreground">{when(check.checked_at)}</small>
                </div>
              </div>
            ))}
          </section>

          <p className="text-[9px] text-muted-foreground">Criado em {when(domain.created_at)}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function DomainsPage() {
  const [items, setItems] = useState([]);
  const [targetHost, setTargetHost] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [form, setForm] = useState({ domain: '', purpose: 'tracking' });

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      const { data } = await api.get(`/domains?${p}`);
      setItems(data.items);
      setTargetHost(data.target_host);
    } catch { /* lista vazia */ }
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    try { const { data } = await api.get(`/domains/${id}`); setDetail(data); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const create = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/domains', form);
      toast.success('Domínio adicionado. Crie os registros de DNS para ativar.');
      setShowCreate(false); setForm({ domain: '', purpose: 'tracking' });
      await load();
      openDetail(data._id);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const verify = async (id) => {
    setVerifying(true);
    try {
      const { data } = await api.post(`/domains/${id}/verify`);
      toast[data.status === 'active' ? 'success' : 'info'](data.detail);
      await load();
      await openDetail(id);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    setVerifying(false);
  };

  const remove = async (item) => {
    if (!window.confirm(`Remover ${item.domain}? Links que usam este domínio param de funcionar.`)) return;
    try { await api.delete(`/domains/${item._id}`); toast.success('Domínio removido'); setDetail(null); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <div data-testid="domains-page">
      <div className="page-header">
        <div>
          <h1>Domínios<span className="accent">.</span></h1>
          <p className="page-description">Seus domínios de rastreamento e presell, com verificação de DNS e certificado.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="create-domain-btn"><Plus size={14} className="mr-2" /> Adicionar domínio</Button>
      </div>

      <div className="data-toolbar">
        <div className="search-input" style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
          <Input placeholder="Buscar domínio…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, height: 32, fontSize: 11 }} />
        </div>
        {targetHost && <span className="text-[10px] text-muted-foreground ml-auto">Aponte seus domínios para <code className="font-mono">{targetHost}</code></span>}
      </div>

      {items.length === 0 ? (
        <div className="stat-card empty-state"><Globe size={32} /><h3>Nenhum domínio</h3><p>Adicione um subdomínio seu para servir os links de rastreamento.</p></div>
      ) : (
        <div className="domain-grid">
          {items.map(item => (
            <div key={item._id} className="stat-card domain-card" data-testid={`domain-${item._id}`}>
              <div className="domain-card-top">
                <span className={`domain-icon ${item.status === 'active' ? 'is-on' : ''}`}><Globe size={16} /></span>
                <Badge className={`text-[9px] ${STATUS_STYLE[item.status] || ''}`}>{item.status_label}</Badge>
              </div>
              <button type="button" className="domain-name" onClick={() => openDetail(item._id)}>{item.domain}</button>
              <p className="text-[10px] text-muted-foreground">{item.purpose_label} · certificado {(item.ssl_label || '').toLowerCase()}</p>
              <div className="domain-card-foot">
                <span className="text-[9px] text-muted-foreground">Verificado {when(item.last_check)}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Verificar" onClick={() => verify(item._id)}><RefreshCw size={13} /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Remover" onClick={() => remove(item)}><Trash2 size={13} /></Button>
                </div>
              </div>
              {item.status === 'active' ? (
                <p className="domain-hint is-ok"><CheckCircle2 size={10} /> Pronto para uso nos links.</p>
              ) : (
                <p className="domain-hint">
                  {item.status === 'dns_ok' ? <Clock size={10} /> : <AlertTriangle size={10} />}
                  {item.status === 'dns_ok' ? 'DNS apontado, aguardando o HTTPS responder.' : 'Falta criar os registros de DNS.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar domínio</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <div>
              <Label className="text-xs">Domínio</Label>
              <Input className="text-xs mt-1" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} required placeholder="trk.seusite.com" />
              <p className="text-[10px] text-muted-foreground mt-1">Use um subdomínio dedicado. Depois de salvar mostramos os registros de DNS para criar.</p>
            </div>
            <div>
              <Label className="text-xs">Para que serve</Label>
              <Select value={form.purpose} onValueChange={v => setForm(f => ({ ...f, purpose: v }))}>
                <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PURPOSES.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit">Adicionar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DomainDrawer domain={detail} onClose={() => setDetail(null)} verifying={verifying} onVerify={() => verify(detail._id)} />
    </div>
  );
}
