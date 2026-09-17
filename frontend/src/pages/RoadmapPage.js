import { Badge } from '@/components/ui/badge';

// Conteúdo estático de propósito: o roadmap é decisão de produto, não dado do workspace.
const PHASES = [
  {
    name: 'Operação completa',
    status: 'Em construção',
    tone: 'badge-warning',
    items: [
      'Copiloto com respostas em tempo real',
      'Busca global e central de notificações',
      'Analytics temporal com funil completo e comparação de período',
      'Inbox com transferência, notas internas e etiquetas',
      'Disparos com templates, supressão e relatório de entrega',
      'Receita com coortes, reconciliação e fechamento de período',
    ],
  },
  {
    name: 'Área pública',
    status: 'Planejado',
    tone: 'badge-info',
    items: ['Cadastro público', 'Documentação', 'Preços', 'Status dos serviços', 'Termos, privacidade e DPA', 'Aceite de convite'],
  },
  {
    name: 'Administração da plataforma',
    status: 'Planejado',
    tone: 'badge-info',
    items: [
      'Planos versionados, direitos e medição de uso',
      'Faturas por tenant',
      'Roteamento, prompts, custo e guardrails de IA',
      'SLOs, incidentes, status page e releases',
      'Suporte, comunicados, compliance (DSR) e equipe global',
    ],
  },
  {
    name: 'Integrações',
    status: 'Planejado',
    tone: 'badge-info',
    items: ['Telegram: mensagens do bot direto no Inbox', 'Meta CAPI: conversões server-side'],
  },
];

export default function RoadmapPage() {
  return (
    <div data-testid="roadmap-page">
      <div className="page-header">
        <div>
          <h1>Roadmap<span className="accent">.</span></h1>
          <p className="page-description">O que está sendo construído e o que vem depois.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {PHASES.map(p => (
          <div key={p.name} className="stat-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">{p.name}</span>
              <Badge className={`text-[9px] ${p.tone}`}>{p.status}</Badge>
            </div>
            <ul className="space-y-1.5">
              {p.items.map(i => <li key={i} className="text-xs text-muted-foreground">· {i}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
