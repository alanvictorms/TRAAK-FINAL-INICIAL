import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

export default function RevenuePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/revenue').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-xs text-muted-foreground p-8">Carregando...</div>;

  const s = data?.summary || {};
  const hasMissingDefs = s.roi === null;

  return (
    <div data-testid="revenue-page">
      <div className="page-header">
        <div>
          <h1>Receita<span className="accent">.</span></h1>
          <p className="page-description">P&L, depósitos, FTDs e reconciliação.</p>
        </div>
        <Badge variant="outline" className="text-[9px]">{data?.currency || 'BRL'} · {data?.period}</Badge>
      </div>

      {hasMissingDefs && (
        <div className="stat-card flex items-center gap-3 p-3 mb-4" style={{ borderColor: 'hsl(42 65% 50% / 0.3)' }}>
          <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            <strong className="text-foreground">Decisão pendente (D05):</strong> ROI, payout e margem aguardam definição formal. Valores exibidos são cálculos iniciais.
          </p>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">DEPÓSITOS BRUTOS</div>
          <div className="stat-value">R$ {(s.deposits || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{s.deposit_count || 0} depósitos</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">FTDs RECONCILIADOS</div>
          <div className="stat-value">{s.ftds || 0}</div>
          <div className="text-[10px] text-muted-foreground mt-1">R$ {(s.ftd_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">NET DEPOSIT</div>
          <div className="stat-value" style={{ color: (s.net_deposit || 0) >= 0 ? 'hsl(89 66% 72%)' : 'hsl(348 77% 71%)' }}>
            R$ {(s.net_deposit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Depósitos - Saques</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">INVESTIMENTO MÍDIA</div>
          <div className="stat-value">R$ {(s.spend || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">CPFTD</div>
          <div className="stat-value">{s.cpftd != null ? `R$ ${s.cpftd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'N/A'}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Investimento ÷ FTDs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">ROI</div>
          <div className="stat-value" style={{ color: s.roi != null ? (s.roi >= 0 ? 'hsl(89 66% 72%)' : 'hsl(348 77% 71%)') : 'hsl(var(--muted-foreground))' }}>
            {s.roi != null ? `${s.roi.toFixed(1)}%` : 'Pendente D05'}
          </div>
        </div>
      </div>

      <div className="stat-card p-4">
        <h3 className="text-xs font-medium mb-3">Observações</h3>
        <ul className="space-y-2 text-[10px] text-muted-foreground">
          <li>• Depósitos e FTDs são calculados a partir de eventos confirmados no Signal Ledger.</li>
          <li>• Net deposit = depósitos brutos - saques. Estornos/ajustes dependem de D08.</li>
          <li>• CPFTD = investimento de mídia ÷ FTDs reconciliados.</li>
          <li>• ROI segue fórmula pendente (D05): (net deposit - investimento) ÷ investimento × 100.</li>
          <li>• Payout, margem e ticket médio aguardam definição comercial.</li>
        </ul>
      </div>
    </div>
  );
}
