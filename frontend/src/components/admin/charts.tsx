import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SERIES, niceMax, shortDay } from './scale';

// Graphiques du tableau de bord (#311) : SVG sans bibliothèque.

const GRID = 'rgba(244, 235, 214, 0.12)';
const MUTED = 'rgba(244, 235, 214, 0.65)';

export interface Series { key: string; label: string; values: number[] }

// Le SVG est dessiné à sa largeur réelle (mesurée), pour que les libellés
// gardent leur taille en pixels sur un petit écran.
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };
const PLOT_H = H - PAD.top - PAD.bottom;
const AXIS_FONT = 14;

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, width];
}

const fmt = (n: number) => n.toLocaleString('fr-FR');

function Frame({ W, max, days, children, onHover, hover, tooltip }: {
  W: number; max: number; days: string[]; children: ReactNode;
  onHover: (i: number | null) => void; hover: number | null; tooltip: ReactNode;
}) {
  const ticks = [0, max / 2, max];
  const bandW = (W - PAD.left - PAD.right) / days.length;
  const xLabels = [0, Math.floor((days.length - 1) / 2), days.length - 1];
  return (
    <div style={{ position: 'relative' }}>
      <svg
        width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block' }}
        onMouseLeave={() => onHover(null)}
        role="img"
      >
        {ticks.map(t => {
          const y = PAD.top + PLOT_H - (t / max) * PLOT_H;
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={AXIS_FONT} fill={MUTED}>{fmt(t)}</text>
            </g>
          );
        })}
        {xLabels.map(i => (
          <text key={i} x={PAD.left + bandW * (i + 0.5)} y={H - 6} textAnchor="middle" fontSize={AXIS_FONT} fill={MUTED}>
            {shortDay(days[i])}
          </text>
        ))}
        {children}
        {hover !== null && (
          <line
            x1={PAD.left + bandW * (hover + 0.5)} x2={PAD.left + bandW * (hover + 0.5)}
            y1={PAD.top} y2={PAD.top + PLOT_H} stroke={MUTED} strokeWidth={1} strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}
        {/* Zones de survol : une colonne entière par jour, plus large que la marque. */}
        {days.map((day, i) => (
          <rect
            key={day} x={PAD.left + bandW * i} y={PAD.top} width={bandW} height={PLOT_H}
            fill="transparent" onMouseEnter={() => onHover(i)} onFocus={() => onHover(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          role="status"
          style={{
            position: 'absolute', top: 0,
            left: `${((PAD.left + bandW * (hover + 0.5)) / W) * 100}%`,
            transform: `translateX(${hover > days.length / 2 ? '-105%' : '5%'})`,
            background: '#081710', border: '1px solid var(--line)', borderRadius: 8,
            padding: '6px 10px', fontSize: 14, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, marginBottom: 6 }}>
      {series.map((s, i) => (
        <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: SERIES[i] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function TooltipBody({ day, series, i, unit }: { day: string; series: Series[]; i: number; unit?: string }) {
  return (
    <>
      <div style={{ color: MUTED, marginBottom: 2 }}>{shortDay(day)}</div>
      {series.map((s, k) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {series.length > 1 && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: SERIES[k] }} />}
          <span>{s.label} : <b>{fmt(s.values[i])}</b>{unit ? ` ${unit}` : ''}</span>
        </div>
      ))}
    </>
  );
}

function DataTable({ days, series, unit }: { days: string[]; series: Series[]; unit?: string }) {
  return (
    <details style={{ marginTop: 6, fontSize: 14 }}>
      <summary style={{ cursor: 'pointer', color: MUTED }}>Voir les données</summary>
      <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
        <table className="admin-table">
          <thead>
            <tr><th>Jour</th>{series.map(s => <th key={s.key}>{s.label}{unit ? ` (${unit})` : ''}</th>)}</tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d}><td>{shortDay(d)}</td>{series.map(s => <td key={s.key}>{fmt(s.values[i])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Courbes (une ou plusieurs séries de même unité, un seul axe). */
export function LineChart({ title, days, series, unit }: { title: string; days: string[]; series: Series[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const [ref, W] = useWidth();
  const max = niceMax(Math.max(0, ...series.flatMap(s => s.values)));
  const bandW = (W - PAD.left - PAD.right) / days.length;
  const x = (i: number) => PAD.left + bandW * (i + 0.5);
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;
  return (
    <figure ref={ref} style={{ margin: 0, minWidth: 0 }} aria-labelledby={id}>
      <figcaption id={id} className="admin-chart-title">{title}</figcaption>
      <Legend series={series} />
      <Frame W={W} max={max} days={days} hover={hover} onHover={setHover}
        tooltip={hover !== null && <TooltipBody day={days[hover]} series={series} i={hover} unit={unit} />}>
        {series.map((s, k) => (
          <g key={s.key} pointerEvents="none">
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none" stroke={SERIES[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            />
            {hover !== null && (
              <circle cx={x(hover)} cy={y(s.values[hover])} r={4} fill={SERIES[k]} stroke="#0c2018" strokeWidth={2} />
            )}
          </g>
        ))}
      </Frame>
      <DataTable days={days} series={series} unit={unit} />
    </figure>
  );
}

// Barre arrondie du côté de la valeur, posée sur la ligne de base.
function barPath(x: number, yTop: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return '';
  const r = round ? Math.min(4, w / 2, h) : 0;
  const yb = yTop + h;
  return `M${x},${yb} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yb} Z`;
}

/** Barres par jour, empilées s'il y a plusieurs séries. */
export function BarChart({ title, days, series, unit }: { title: string; days: string[]; series: Series[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const totals = days.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  const [ref, W] = useWidth();
  const max = niceMax(Math.max(0, ...totals));
  const bandW = (W - PAD.left - PAD.right) / days.length;
  const barW = Math.max(2, Math.min(24, bandW - 2));
  const scale = (v: number) => (v / max) * PLOT_H;
  return (
    <figure ref={ref} style={{ margin: 0, minWidth: 0 }} aria-labelledby={id}>
      <figcaption id={id} className="admin-chart-title">{title}</figcaption>
      <Legend series={series} />
      <Frame W={W} max={max} days={days} hover={hover} onHover={setHover}
        tooltip={hover !== null && <TooltipBody day={days[hover]} series={series} i={hover} unit={unit} />}>
        {days.map((day, i) => {
          const x = PAD.left + bandW * i + (bandW - barW) / 2;
          let base = PAD.top + PLOT_H;
          const top = series.map(s => s.values[i] > 0).lastIndexOf(true);
          return (
            <g key={day} pointerEvents="none" opacity={hover === null || hover === i ? 1 : 0.55}>
              {series.map((s, k) => {
                const h = scale(s.values[i]);
                // Espace de 2 px entre segments empilés.
                const gap = k > 0 && h > 0 && base < PAD.top + PLOT_H ? 2 : 0;
                const d = barPath(x, base - h, barW, Math.max(0, h - gap), k === top);
                base -= h;
                return d ? <path key={s.key} d={d} fill={SERIES[k]} /> : null;
              })}
            </g>
          );
        })}
      </Frame>
      <DataTable days={days} series={series} unit={unit} />
    </figure>
  );
}

/** Chiffre clé. */
export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="admin-tile">
      <div className="admin-tile__label">{label}</div>
      <div className="admin-tile__value">{typeof value === 'number' ? fmt(value) : value}</div>
      {hint && <div className="admin-tile__hint">{hint}</div>}
    </div>
  );
}

/** Classement (pays, pages…) : tableau avec une barre de proportion. */
export function RankedTable({ title, rows, labelOf = (l: string) => l }: {
  title: string; rows: Array<{ label: string; visits: number; visitors: number }>; labelOf?: (l: string) => string;
}) {
  const max = Math.max(1, ...rows.map(r => r.visits));
  return (
    <div>
      <h3 className="admin-chart-title">{title}</h3>
      {rows.length === 0 ? <p style={{ color: MUTED, fontSize: 14 }}>Aucune donnée.</p> : (
        <table className="admin-table">
          <thead><tr><th /><th>Visites</th><th>Visiteurs</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label}>
                <td style={{ width: '60%' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(r.label)}</div>
                  <div aria-hidden style={{ height: 4, borderRadius: 2, marginTop: 3, background: SERIES[0], width: `${(r.visits / max) * 100}%` }} />
                </td>
                <td>{fmt(r.visits)}</td>
                <td>{fmt(r.visitors)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
