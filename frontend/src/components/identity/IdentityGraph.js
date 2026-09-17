import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';

const short = (value, keep = 4) => {
  const text = String(value ?? '');
  return text.length > keep * 2 + 2 ? `${text.slice(0, keep)}…${text.slice(-keep)}` : text || '—';
};
const hhmm = value => (value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');

const STEP_COPY = {
  click: ['Clique capturado', 'click_id guardado com a fonte e a campanha'],
  bot_start: ['Telegram vinculado', 'token do link resolvido no /start'],
  channel_join: ['Entrou no canal', 'o bot confirmou a entrada'],
  register: ['Cadastro na casa', 'customer_id recebido pelo postback'],
  ftd: ['Primeiro depósito', 'clique de aquisição congelado'],
};

/** Vínculos do lead: identidade no centro, cada identificador ao redor, e como cada um chegou. */
export default function IdentityGraph({ player }) {
  const nodes = useMemo(() => {
    const ids = player.external_ids || {};
    const acquisition = player.acquisition || {};
    const click = acquisition.attribution?.click_id;
    const telegram = ids.telegram_user_id;
    const whatsapp = ids.whatsapp_user_id;
    const customer = player.provider?.customer_id || ids.tap_customer_id;
    const phone = player.contact?.phone;
    const out = [];
    if (click) {
      out.push({
        key: 'click', kind: 'Aquisição', title: `CLICK ${short(click, 4)}`, tone: 'blue',
        detail: [acquisition.attribution?.source, acquisition.campaign?.name || acquisition.link?.name].filter(Boolean).join(' · ') || 'origem registrada',
      });
    }
    if (telegram || whatsapp) {
      out.push({
        key: 'messaging', kind: 'Mensageria', tone: 'violet',
        title: telegram ? `TG ${telegram}` : `WA ${short(whatsapp, 5)}`,
        detail: ids.telegram_username ? `@${ids.telegram_username}` : 'canal de atendimento',
      });
    }
    if (phone || player.contact?.email) {
      out.push({
        key: 'pii', kind: 'Dado pessoal', tone: 'slate',
        title: phone ? `TEL ${short(phone, 4)}` : `MAIL ${short(player.contact.email, 4)}`,
        detail: phone ? 'telefone confirmado' : 'e-mail informado',
      });
    }
    if (customer) {
      out.push({ key: 'revenue', kind: 'Receita', tone: 'green', title: `CUS ${customer}`, detail: 'cliente na casa' });
    }
    return out;
  }, [player]);

  const timeline = (player.journey || []).filter(step => step.at);
  const confidence = player.confidence || (timeline.length >= 3 ? 'high' : timeline.length >= 1 ? 'medium' : 'low');
  const confidenceLabel = { high: 'Alta confiança', medium: 'Confiança média', low: 'Confiança baixa' }[confidence];

  return (
    <div className="identity-graph">
      <div className="identity-canvas">
        <svg className="identity-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {nodes.map((node, i) => {
            const points = [[18, 22], [82, 22], [18, 78], [82, 78]][i] || [50, 50];
            return <line key={node.key} x1="50" y1="50" x2={points[0]} y2={points[1]} />;
          })}
        </svg>

        <div className="identity-node is-center">
          <span>Identidade</span>
          <strong>PERSON {short(player._id, 4).toUpperCase()}</strong>
          <small>{player.name || 'sem nome'}</small>
        </div>

        {nodes.map((node, i) => (
          <div key={node.key} className={`identity-node pos-${i} tone-${node.tone}`}>
            <span>{node.kind}</span>
            <strong>{node.title}</strong>
            <small>{node.detail}</small>
          </div>
        ))}

        {nodes.length === 0 && <p className="text-[10px] text-muted-foreground">Este lead ainda não tem identificadores vinculados.</p>}
      </div>

      <div className="identity-provenance">
        <header>
          <div>
            <strong>Linha da procedência</strong>
            <small>Como a identidade foi construída</small>
          </div>
          <Badge variant="outline" className="text-[9px]">{confidenceLabel}</Badge>
        </header>
        <div className="identity-steps">
          {timeline.length === 0 && <p className="text-[10px] text-muted-foreground">Nenhum passo registrado ainda.</p>}
          {timeline.map(step => {
            const [title, detail] = STEP_COPY[step.key] || [step.label, step.source || ''];
            return (
              <div key={step.key} className="identity-step">
                <time>{hhmm(step.at)}</time>
                <span className={`dot tone-${step.key}`} />
                <div>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                  <em>{new Date(step.at).toLocaleDateString('pt-BR')}</em>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
