import { useState } from 'react';
import { num } from '@/lib/utils';

/** Funil em blocos, com topo arredondado para dar volume. Tooltip mostra os números. */
const COLORS = ['#F6F1E7', '#DED7CB', '#BFC7D6', '#9FB0CC', '#8290B4', '#6B7699', '#575F7D'];
const WIDTH = 420;
const BAND = 62;
const CAP = 13;

export default function FunnelView({ steps, compare }) {
  const [hover, setHover] = useState(null);
  const top = Math.max(1, steps[0]?.count || 1);
  const height = steps.length * BAND + CAP * 2;

  // Largura de cada degrau proporcional ao volume, com piso para continuar legível.
  const widthAt = value => {
    const ratio = Math.max(0.16, Math.sqrt((value || 0) / top));
    return WIDTH * 0.92 * ratio;
  };

  return (
    <div className="funnel-view">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" height={height} role="img" aria-label="Funil de conversão">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const wTop = widthAt(step.count);
          const wBottom = widthAt(next ? next.count : step.count * 0.55);
          const y = CAP + i * BAND;
          const color = COLORS[i % COLORS.length];
          const x1 = (WIDTH - wTop) / 2;
          const x2 = (WIDTH - wBottom) / 2;
          const active = hover === i;
          return (
            <g key={step.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <ellipse cx={WIDTH / 2} cy={y} rx={wTop / 2} ry={CAP} fill={color} opacity={active ? 0.95 : 0.78} />
              <path d={`M${x1} ${y} L${x1 + wTop} ${y} L${x2 + wBottom} ${y + BAND} L${x2} ${y + BAND} Z`}
                fill={color} opacity={active ? 0.95 : 0.62} />
              <ellipse cx={WIDTH / 2} cy={y + BAND} rx={wBottom / 2} ry={CAP} fill={color} opacity={active ? 0.6 : 0.45} />
              <text x={WIDTH / 2} y={y + BAND / 2 + 2} textAnchor="middle" fill="#131315"
                fontSize="15" fontWeight="700">{num(step.count)}</text>
              <text x={WIDTH / 2} y={y + BAND / 2 + 17} textAnchor="middle" fill="#3A3A40" fontSize="9">{step.label}</text>
            </g>
          );
        })}
      </svg>

      <div className="funnel-tip" aria-live="polite">
        {hover === null ? (
          <p className="text-[10px] text-muted-foreground">Passe o mouse em um degrau para ver os números.</p>
        ) : (
          <>
            <strong className="text-xs">{steps[hover].label}</strong>
            <p className="text-[11px] tabular-nums">{num(steps[hover].count)} no degrau</p>
            {steps[hover].step_rate !== null && steps[hover].step_rate !== undefined && (
              <p className="text-[10px] text-muted-foreground">{steps[hover].step_rate.toLocaleString('pt-BR')}% de quem veio do degrau anterior</p>
            )}
            {steps[0]?.count > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {((steps[hover].count / steps[0].count) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de quem clicou
              </p>
            )}
            {compare && <p className="text-[10px] text-muted-foreground">Período anterior: {num(steps[hover].previous)}</p>}
          </>
        )}
      </div>
    </div>
  );
}
