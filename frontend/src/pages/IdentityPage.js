import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Search, Fingerprint, Eye, EyeOff, Link2, Clock } from 'lucide-react';

const CONFIDENCE = { high: ['Alta', 'badge-success'], medium: ['Média', 'badge-warning'], low: ['Baixa', 'badge-warning'] };
const STATUS = { active: 'Ativo', blocked: 'Bloqueado', inactive: 'Inativo' };
const EVENTS = { click: 'Clique', bot_start: 'Abriu o bot', channel_join: 'Entrou no canal', register: 'Cadastro',
  ftd: 'Primeiro depósito', deposit: 'Depósito', withdrawal: 'Saque' };
const mask = value => (value ? `${String(value).slice(0, 2)}••••${String(value).slice(-2)}` : '—');
import { toast } from 'sonner';

export default function IdentityPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [showDetail, setShowDetail] = useState(null);
  const [piiRevealed, setPiiRevealed] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      const { data } = await api.get(`/identity?${p}`);
      setItems(data.items); setTotal(data.total);
    } catch {}
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const loadPlayer = async (id) => {
    try { const { data } = await api.get(`/players/${id}`); setShowDetail(data); setPiiRevealed(false); } catch {}
  };

  return (
    <div data-testid="identity-page">
      <div className="page-header">
        <div><h1>Identity Graph<span className="accent">.</span></h1><p className="page-description">Vínculos, resolução de identidade e PII protegido.</p></div>
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people" className="text-xs">Pessoas</TabsTrigger>
          <TabsTrigger value="debug" className="text-xs">Como os vínculos são feitos</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-4">
          <div className="data-toolbar">
            <div className="search-input" style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))' }} />
              <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32, height: 32, fontSize: 11 }} />
            </div>
            <Badge variant="outline" className="text-[9px] ml-auto">{total} identidades</Badge>
          </div>
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Nome</TableHead>
                <TableHead className="text-xs">Identificadores</TableHead>
                <TableHead className="text-xs">Confiança</TableHead>
                <TableHead className="text-xs">Origem</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow><TableCell colSpan={6}><div className="empty-state"><Fingerprint size={32} /><h3>Nenhuma identidade</h3></div></TableCell></TableRow>
                ) : items.map(i => (
                  <TableRow key={i._id}>
                    <TableCell className="text-xs font-medium">{i.name || i._id.slice(-8)}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{(i.identifiers || []).join(', ') || '—'}</TableCell>
                    <TableCell><Badge className={`text-[9px] ${(CONFIDENCE[i.confidence] || [])[1] || ''}`}>{(CONFIDENCE[i.confidence] || [i.confidence])[0]}</Badge></TableCell>
                    <TableCell className="text-xs">{i.origin || '—'}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{STATUS[i.status] || i.status}</Badge></TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadPlayer(i._id)}><Eye size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="debug" className="mt-4">
          <div className="stat-card p-4">
            <p className="text-xs text-muted-foreground">Cada identidade junta os identificadores que chegaram pelos canais e pela casa (Telegram, WhatsApp, cliente na casa). A confiança é alta quando o vínculo veio de um identificador único, como o id do Telegram ou o id do cliente na casa.</p>
          </div>
        </TabsContent>
      </Tabs>

      <Sheet open={!!showDetail} onOpenChange={o => !o && setShowDetail(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto" data-testid="identity-drawer">
          <SheetHeader><SheetTitle className="text-base">{showDetail?.name || 'Identidade'}</SheetTitle></SheetHeader>
          {showDetail && (
            <div className="mt-4 space-y-4">
              <div className="drawer-summary">
                <div><span>Origem</span><strong>{showDetail.origin || '—'}</strong></div>
                <div><span>Etapa</span><strong>{showDetail.pipeline_stage || 'sem etapa'}</strong></div>
                <div><span>Depositou</span><strong>{showDetail.has_ftd ? 'sim' : 'não'}</strong></div>
                <div><span>Eventos</span><strong>{(showDetail.events || []).length}</strong></div>
              </div>

              <section>
                <div className="flex items-center justify-between">
                  <p className="drawer-label">Identificadores</p>
                  <Button variant="outline" size="sm" className="text-[10px] h-6 gap-1" onClick={() => setPiiRevealed(!piiRevealed)} data-testid="toggle-pii">
                    {piiRevealed ? <EyeOff size={11} /> : <Eye size={11} />}{piiRevealed ? 'Mascarar' : 'Revelar'}
                  </Button>
                </div>
                <div className="identity-rows">
                  <div><span>Nome</span><strong>{piiRevealed ? showDetail.name : mask(showDetail.name)}</strong></div>
                  {Object.entries(showDetail.external_ids || {}).map(([key, value]) => (
                    <div key={key}><span>{key.replace(/_/g, ' ')}</span><strong className="font-mono">{piiRevealed ? value : mask(value)}</strong></div>
                  ))}
                  {showDetail.contact?.phone && <div><span>Telefone</span><strong>{piiRevealed ? showDetail.contact.phone : mask(showDetail.contact.phone)}</strong></div>}
                  {showDetail.contact?.email && <div><span>E-mail</span><strong>{piiRevealed ? showDetail.contact.email : mask(showDetail.contact.email)}</strong></div>}
                </div>
                <p className="text-[9px] text-muted-foreground mt-2">Dados pessoais ficam mascarados por padrão. Revelar fica registrado na auditoria.</p>
              </section>

              <section>
                <p className="drawer-label">Etiquetas</p>
                <div className="flex flex-wrap gap-1">
                  {(showDetail.tags || []).length === 0 && <span className="text-[10px] text-muted-foreground">Nenhuma etiqueta.</span>}
                  {(showDetail.tags || []).map(tag => <Badge key={tag} variant="outline" className="text-[9px]">{tag}</Badge>)}
                </div>
              </section>

              <section>
                <p className="drawer-label">Como este lead chegou</p>
                {showDetail.acquisition ? (
                  <div className="identity-rows">
                    <div><span>Fonte</span><strong>{showDetail.acquisition.source || '—'}</strong></div>
                    <div><span>Link</span><strong>{showDetail.acquisition.link_name || '—'}</strong></div>
                    <div><span>Clique em</span><strong>{showDetail.acquisition.clicked_at ? new Date(showDetail.acquisition.clicked_at).toLocaleString('pt-BR') : '—'}</strong></div>
                  </div>
                ) : <p className="text-[10px] text-muted-foreground">Sem atribuição registrada.</p>}
              </section>

              <section>
                <p className="drawer-label">Linha do tempo</p>
                {(showDetail.events || []).length === 0 && <p className="text-[10px] text-muted-foreground">Nenhum evento ainda.</p>}
                {(showDetail.events || []).slice(0, 20).map(ev => (
                  <div key={ev._id} className="identity-event">
                    <span><Clock size={10} /></span>
                    <div>
                      <p className="text-[10px]">{EVENTS[ev.type] || ev.type}{ev.value ? ` · R$ ${Number(ev.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}</p>
                      <small className="text-[9px] text-muted-foreground">{new Date(ev.created_at).toLocaleString('pt-BR')}{ev.source ? ` · ${ev.source}` : ''}</small>
                    </div>
                  </div>
                ))}
              </section>

              <Button variant="outline" size="sm" className="w-full text-[10px]" onClick={() => { window.location.href = `/players/${showDetail._id}`; }}>
                <Link2 size={12} className="mr-1" /> Abrir ficha completa do lead
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}
