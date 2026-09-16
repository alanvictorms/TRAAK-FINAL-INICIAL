import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, Circle, ArrowRight, Link2, Radar, Globe, Workflow, Sparkles,
  AlertTriangle, BarChart3, Activity
} from 'lucide-react';

const checklist = [
  { key: 'workspace', label: 'Workspace configurado', icon: CheckCircle2 },
  { key: 'domain', label: 'Domínio de tracking', icon: Globe, route: '/domains' },
  { key: 'integration', label: 'Integração de receita', icon: Radar, route: '/integrations' },
  { key: 'link', label: 'Primeiro link de tracking', icon: Link2, route: '/tracking' },
  { key: 'automation', label: 'Automação configurada', icon: Workflow, route: '/automations' },
];

export default function CommandPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [domains, integrations, links, automations, events] = await Promise.all([
          api.get('/domains?limit=1'),
          api.get('/integrations?limit=1'),
          api.get('/tracking?limit=1'),
          api.get('/automations?limit=1'),
          api.get('/ledger?limit=1'),
        ]);
        setStatus({
          workspace: true,
          domain: domains.data.total > 0,
          integration: integrations.data.total > 0,
          link: links.data.total > 0,
          automation: automations.data.total > 0,
        });
        setStats({
          domains: domains.data.total,
          integrations: integrations.data.total,
          links: links.data.total,
          automations: automations.data.total,
          events: events.data.total,
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const completed = Object.values(status).filter(Boolean).length;
  const progress = checklist.length > 0 ? (completed / checklist.length) * 100 : 0;

  return (
    <div data-testid="command-page">
      <div className="page-header">
        <div>
          <h1>Olá, {user?.name || 'operador'}<span className="accent">.</span></h1>
          <p className="page-description">Configure sua operação e acompanhe o progresso.</p>
        </div>
      </div>

      {/* Onboarding Checklist */}
      <div className="stat-card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', fontWeight: 500 }}>Ativação da operação</span>
          <Badge variant="outline" className={progress === 100 ? 'badge-success' : 'badge-warning'}>
            {completed}/{checklist.length} etapas
          </Badge>
        </div>
        <Progress value={progress} className="h-1.5 mb-4" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {checklist.map(item => {
            const done = status[item.key];
            return (
              <div
                key={item.key}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '6px', background: done ? 'hsl(130 25% 12%)' : 'transparent', cursor: item.route ? 'pointer' : 'default' }}
                onClick={() => item.route && !done && navigate(item.route)}
                data-testid={`checklist-${item.key}`}
              >
                {done ? <CheckCircle2 size={14} className="text-primary" /> : <Circle size={14} className="text-muted-foreground" />}
                <span style={{ fontSize: '11px', flex: 1, color: done ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>{item.label}</span>
                {!done && item.route && <ArrowRight size={12} className="text-muted-foreground" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Stats */}
      {!loading && stats && (
        <div className="stats-grid" data-testid="command-stats">
          <div className="stat-card">
            <div className="stat-label">INTEGRAÇÕES</div>
            <div className="stat-value">{stats.integrations}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">LINKS ATIVOS</div>
            <div className="stat-value">{stats.links}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">EVENTOS NO LEDGER</div>
            <div className="stat-value">{stats.events}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">AUTOMAÇÕES</div>
            <div className="stat-value">{stats.automations}</div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Button variant="outline" size="sm" onClick={() => navigate('/integrations')} data-testid="quick-integrations">
          <Radar size={14} className="mr-2" /> Conectar integração
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate('/tracking')} data-testid="quick-tracking">
          <Link2 size={14} className="mr-2" /> Criar link
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate('/analytics')} data-testid="quick-analytics">
          <BarChart3 size={14} className="mr-2" /> Ver analytics
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate('/ledger')} data-testid="quick-ledger">
          <Activity size={14} className="mr-2" /> Signal Ledger
        </Button>
      </div>
    </div>
  );
}
