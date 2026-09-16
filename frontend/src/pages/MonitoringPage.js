import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Radar, Activity, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function MonitoringPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/monitoring').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const reprocess = async (id) => {
    try {
      await api.post(`/monitoring/reprocess/${id}`);
      toast.success('Evento reenfileirado');
      const { data: d } = await api.get('/monitoring');
      setData(d);
    } catch { toast.error('Erro'); }
  };

  if (loading) return <div className="text-xs text-muted-foreground p-8">Carregando...</div>;

  return (
    <div data-testid="monitoring-page">
      <div className="page-header">
        <div><h1>Monitoramento<span className="accent">.</span></h1><p className="page-description">Disponibilidade, latência, alertas e DLQ.</p></div>
      </div>

      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health" className="text-xs gap-1.5"><Radar size={12} /> Integrações</TabsTrigger>
          <TabsTrigger value="dlq" className="text-xs gap-1.5"><AlertTriangle size={12} /> DLQ ({data?.dlq?.count || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Integração</TableHead>
                <TableHead className="text-xs">Provedor</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Última sincronização</TableHead>
                <TableHead className="text-xs">Último teste</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(data?.integrations || []).length === 0 ? (
                  <TableRow><TableCell colSpan={5}><div className="empty-state"><Radar size={28} /><h3>Sem integrações</h3></div></TableCell></TableRow>
                ) : (data?.integrations || []).map(i => (
                  <TableRow key={i.id}>
                    <TableCell className="text-xs font-medium">{i.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{i.provider}</TableCell>
                    <TableCell><Badge className={`text-[9px] ${i.status === 'active' || i.status === 'configured' ? 'badge-success' : i.status === 'error' ? 'badge-error' : ''}`}>{i.status}</Badge></TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{i.last_sync ? new Date(i.last_sync).toLocaleString('pt-BR') : '—'}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{i.last_test?.status || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="stats-grid mt-4">
            <div className="stat-card"><div className="stat-label">EVENTOS (24H)</div><div className="stat-value">{data?.metrics?.total_events_24h || 0}</div></div>
            <div className="stat-card"><div className="stat-label">FALHAS (24H)</div><div className="stat-value" style={{ color: (data?.metrics?.failed_24h || 0) > 0 ? 'hsl(348 77% 71%)' : 'inherit' }}>{data?.metrics?.failed_24h || 0}</div></div>
          </div>
        </TabsContent>

        <TabsContent value="dlq" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">ID</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Fonte</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Tentativas</TableHead>
                <TableHead className="text-xs">Data</TableHead>
                <TableHead className="text-xs text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(data?.dlq?.items || []).length === 0 ? (
                  <TableRow><TableCell colSpan={7}><div className="empty-state"><CheckCircle2 size={28} /><h3>DLQ vazia</h3><p>Nenhum evento na fila de erros.</p></div></TableCell></TableRow>
                ) : (data?.dlq?.items || []).map(e => (
                  <TableRow key={e._id}>
                    <TableCell className="text-[10px] font-mono">{e._id?.slice(-8)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{e.type}</Badge></TableCell>
                    <TableCell className="text-xs">{e.source || '—'}</TableCell>
                    <TableCell><Badge className="text-[9px] badge-error">{e.status}</Badge></TableCell>
                    <TableCell className="text-xs">{(e.attempts || []).length}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">{new Date(e.created_at).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => reprocess(e._id)}><RefreshCw size={13} /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
