import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { BarChart3, Headphones } from 'lucide-react';

export default function AnalyticsPage({ tab: initialTab }) {
  const [tab, setTab] = useState(initialTab || 'media');
  const [mediaData, setMediaData] = useState([]);
  const [atendData, setAtendData] = useState(null);

  useEffect(() => {
    if (tab === 'media') {
      api.get('/analytics').then(r => setMediaData(r.data.items || [])).catch(() => {});
    } else {
      api.get('/analytics/atendimento').then(r => setAtendData(r.data)).catch(() => {});
    }
  }, [tab]);

  return (
    <div data-testid="analytics-page">
      <div className="page-header">
        <div>
          <h1>Analytics<span className="accent">.</span></h1>
          <p className="page-description">Aquisição, conversão e retorno por origem e período.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="media" className="text-xs gap-1.5"><BarChart3 size={12} /> Mídia</TabsTrigger>
          <TabsTrigger value="atendimento" className="text-xs gap-1.5"><Headphones size={12} /> Atendimento</TabsTrigger>
        </TabsList>

        <TabsContent value="media" className="mt-4">
          <div className="stat-card" style={{ overflow: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Origem</TableHead>
                  <TableHead className="text-xs">Cliques</TableHead>
                  <TableHead className="text-xs">Cadastros</TableHead>
                  <TableHead className="text-xs">FTDs</TableHead>
                  <TableHead className="text-xs">Depósitos</TableHead>
                  <TableHead className="text-xs">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mediaData.length === 0 ? (
                  <TableRow><TableCell colSpan={6}><div className="empty-state"><BarChart3 size={28} /><h3>Sem dados</h3><p>Dados aparecerão conforme eventos forem registrados no Ledger.</p></div></TableCell></TableRow>
                ) : mediaData.map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{item.source}</TableCell>
                    <TableCell className="text-xs">{item.clicks}</TableCell>
                    <TableCell className="text-xs">{item.registrations}</TableCell>
                    <TableCell className="text-xs">{item.ftds}</TableCell>
                    <TableCell className="text-xs">{item.deposits}</TableCell>
                    <TableCell className="text-xs">R$ {(item.value || 0).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="atendimento" className="mt-4">
          {atendData && (
            <div className="stats-grid mb-4">
              <div className="stat-card"><div className="stat-label">NA FILA</div><div className="stat-value">{atendData.queue}</div></div>
              <div className="stat-card"><div className="stat-label">EM ATENDIMENTO</div><div className="stat-value">{atendData.active}</div></div>
            </div>
          )}
          <div className="stat-card p-4">
            <p className="text-xs text-muted-foreground">Métricas de primeira resposta, SLA e conversão por atendente aguardam definição (D06).</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
