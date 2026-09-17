import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { money, num } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Radar, Copy } from 'lucide-react';
import { toast } from 'sonner';

const LABELS = { meta: 'Meta Ads', tiktok: 'TikTok Ads', google: 'Google Ads', kwai: 'Kwai Ads', direct: 'Direto / sem UTM' };

export default function SourcesPage() {
  const [data, setData] = useState({ items: [], totals: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tracking/sources')
      .then(r => setData(r.data))
      .catch(() => toast.error('Não foi possível carregar as fontes'))
      .finally(() => setLoading(false));
  }, []);

  const copy = (text) => { navigator.clipboard.writeText(text); toast.success('Macro copiada'); };
  const { items, totals } = data;

  return (
    <div data-testid="sources-page">
      <div className="page-header">
        <div>
          <h1>Fontes de tráfego<span className="accent">.</span></h1>
          <p className="page-description">Investimento, cliques e FTDs por origem. Cliques e FTDs vêm do Signal Ledger; investimento, das campanhas.</p>
        </div>
      </div>

      {totals && (
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-label">Investimento</div><div className="stat-value">{money(totals.spend)}</div></div>
          <div className="stat-card"><div className="stat-label">Cliques</div><div className="stat-value">{num(totals.clicks)}</div></div>
          <div className="stat-card"><div className="stat-label">FTDs</div><div className="stat-value">{num(totals.ftds)}</div></div>
          <div className="stat-card"><div className="stat-label">CPFTD</div><div className="stat-value">{money(totals.cpftd)}</div></div>
        </div>
      )}

      <div className="stat-card" style={{ overflow: 'auto' }}>
        <TooltipProvider>
          <Table>
            <TableHeader><TableRow>
              <TableHead className="text-xs">Fonte</TableHead>
              <TableHead className="text-xs">Macro de URL</TableHead>
              <TableHead className="text-xs text-right">Links</TableHead>
              <TableHead className="text-xs text-right">Cliques</TableHead>
              <TableHead className="text-xs text-right">Investimento</TableHead>
              <TableHead className="text-xs text-right">FTDs</TableHead>
              <TableHead className="text-xs text-right">CPFTD</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-xs text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={7}><div className="empty-state"><Radar size={32} /><h3>Nenhuma fonte ainda</h3><p>As fontes aparecem quando houver links com UTM, campanhas ou eventos no ledger.</p></div></TableCell></TableRow>
              ) : items.map(r => (
                <TableRow key={r.source} data-testid={`source-row-${r.source}`}>
                  <TableCell className="text-xs font-medium">{LABELS[r.source] || r.source}</TableCell>
                  <TableCell>
                    {r.macro ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] font-mono gap-1" onClick={() => copy(r.macro)}>
                            <Copy size={11} /> copiar
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm font-mono text-[10px] break-all">{r.macro}</TooltipContent>
                      </Tooltip>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-right">{num(r.links)}</TableCell>
                  <TableCell className="text-xs text-right">{num(r.clicks)}</TableCell>
                  <TableCell className="text-xs text-right">{money(r.spend)}</TableCell>
                  <TableCell className="text-xs text-right">{num(r.ftds)}</TableCell>
                  <TableCell className="text-right">
                    {r.cpftd === null
                      ? <span className="text-[10px] text-muted-foreground">sem FTD</span>
                      : <Badge variant="outline" className="text-[10px]">{money(r.cpftd)}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      </div>
    </div>
  );
}
