import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Search, Fingerprint, Eye, EyeOff, RefreshCw } from 'lucide-react';
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
          <TabsTrigger value="debug" className="text-xs">Resolution debug</TabsTrigger>
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
                    <TableCell><Badge className={`text-[9px] ${i.confidence === 'high' ? 'badge-success' : 'badge-warning'}`}>{i.confidence}</Badge></TableCell>
                    <TableCell className="text-xs">{i.origin || '—'}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{i.status}</Badge></TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => loadPlayer(i._id)}><Eye size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="debug" className="mt-4">
          <div className="stat-card p-4">
            <p className="text-xs text-muted-foreground">Resolution debug mostra por que cada vínculo existe e conflitos detectados. Confiança é indicador determinístico quando calculada, não probabilidade garantida.</p>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!showDetail} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{showDetail?.name || 'Identidade'}</DialogTitle></DialogHeader>
          {showDetail && (
            <Tabs defaultValue="identity">
              <TabsList className="w-full">
                <TabsTrigger value="identity" className="text-xs flex-1">Identidade</TabsTrigger>
                <TabsTrigger value="timeline" className="text-xs flex-1">Timeline</TabsTrigger>
                <TabsTrigger value="pii" className="text-xs flex-1">Dados PII</TabsTrigger>
              </TabsList>
              <TabsContent value="identity" className="mt-3 space-y-2 text-xs">
                <div><span className="text-muted-foreground">Origem:</span> {showDetail.origin || '—'}</div>
                <div><span className="text-muted-foreground">Identificadores externos:</span></div>
                {Object.entries(showDetail.external_ids || {}).map(([k, v]) => (
                  <div key={k} className="text-[10px] pl-3">{k}: <span className="font-mono">{v}</span></div>
                ))}
                <div><span className="text-muted-foreground">Tags:</span> {(showDetail.tags || []).join(', ') || '—'}</div>
              </TabsContent>
              <TabsContent value="timeline" className="mt-3">
                <div className="space-y-2">
                  {(showDetail.events || []).slice(0, 15).map(ev => (
                    <div key={ev._id} className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-muted">
                      <Badge className="text-[8px]">{ev.type}</Badge>
                      <span className="text-muted-foreground">{ev.status}</span>
                      {ev.value && <span>R$ {ev.value.toFixed(2)}</span>}
                      <span className="ml-auto text-muted-foreground">{new Date(ev.created_at).toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="pii" className="mt-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">Dados mascarados por padrão</span>
                  <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1" onClick={() => setPiiRevealed(!piiRevealed)}>
                    {piiRevealed ? <EyeOff size={11} /> : <Eye size={11} />}
                    {piiRevealed ? 'Mascarar' : 'Revelar'}
                  </Button>
                </div>
                <div className="space-y-2 text-xs">
                  <div><span className="text-muted-foreground">Nome:</span> {piiRevealed ? showDetail.name : '••••••••'}</div>
                  {Object.entries(showDetail.external_ids || {}).map(([k, v]) => (
                    <div key={k}><span className="text-muted-foreground">{k}:</span> {piiRevealed ? v : '••••••••'}</div>
                  ))}
                </div>
                {piiRevealed && <p className="text-[9px] text-warning mt-3">Acesso registrado na auditoria.</p>}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
