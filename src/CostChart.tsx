import { useEffect, useRef, useState } from 'react';
import { money, type Quote } from './lib';

// Categorical slots, validated on the white panel surface (adjacent CVD ΔE ≥ 9.1, normal-vision ≥ 22.9).
// Aqua and yellow sit below 3:1 contrast, so every line also carries a direct label and the table view.
// Colors follow the option (its position in the stable card order), never its rank.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const NEUTRAL = '#898781';

const SHORT: Record<string, string> = {
  return: 'Return it',
  buyout: 'Buy yours',
  upgrade_lease: 'Lease new',
  upgrade_buy: 'Buy new',
  keep: 'Keep loan',
  refinance: 'Refinance',
  pay_extra: 'Pay extra',
};

export function seriesColor(index: number): string {
  return SERIES[index] ?? NEUTRAL;
}

function shortName(key: string): string {
  return SHORT[key] ?? key;
}

function monthLabel(m: number): string {
  if (m === 0) return 'Today';
  if (m % 12 === 0) return `${m / 12} yr`;
  return `${m} mo`;
}

function niceStep(range: number, target = 5): number {
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function axisMoney(v: number, compact: boolean): string {
  if (v === 0) return '$0';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return compact ? `${sign}$${(a / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : `${sign}$${a.toLocaleString('en-US')}`;
}

function compactMoney(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return a >= 1000 ? `${sign}$${(a / 1000).toFixed(1)}K` : `${sign}$${Math.round(a)}`;
}

// The month from which `a` stays on the side of `b` it ends on, or null if it was never strictly on the
// other side (two lines that merely start equal haven't crossed).
function crossingMonth(a: Quote, b: Quote): number | null {
  const d = (m: number) => a.path[m] - b.path[m];
  const end = Math.sign(d(36));
  if (end === 0) return null;
  let lastOpposite = -1;
  for (let m = 0; m < 36; m++) if (Math.sign(d(m)) === -end) lastOpposite = m;
  return lastOpposite === -1 ? null : lastOpposite + 1;
}

type Crossing = { month: number; cheaper: Quote; other: Quote };

// Prefer a crossing that involves the best fit; otherwise the first crossing between higher-ranked options.
function pickCrossing(quotes: Quote[]): Crossing | null {
  const ranked = [...quotes].sort((a, b) => a.rank - b.rank);
  const best = ranked.find(q => q.recommended);
  const pairs: [Quote, Quote][] = [];
  if (best) for (const q of ranked) if (q !== best) pairs.push([best, q]);
  for (let i = 0; i < ranked.length; i++)
    for (let j = i + 1; j < ranked.length; j++) if (ranked[i] !== best && ranked[j] !== best) pairs.push([ranked[i], ranked[j]]);
  for (const [a, b] of pairs) {
    const month = crossingMonth(a, b);
    if (month !== null) {
      const cheaper = a.path[36] < b.path[36] ? a : b;
      return { month, cheaper, other: cheaper === a ? b : a };
    }
  }
  return null;
}

const H = 280;

export function CostChart({ quotes }: { quotes: Quote[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `quotes` arrive in the stable card order, so index = color slot.
  const series = quotes
    .map((q, i) => ({ q, color: seriesColor(i), name: shortName(q.key) }))
    .filter(s => s.q.path.length === 37);
  if (series.length === 0) return null;

  const showEndLabels = width >= 560;
  const M = { top: 14, right: showEndLabels ? 128 : 16, bottom: 30, left: 58 };
  const plotW = Math.max(120, width - M.left - M.right);
  const plotH = H - M.top - M.bottom;

  const all = series.flatMap(s => s.q.path);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  const step = niceStep(hi - lo || 1);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v));
  const compact = Math.max(Math.abs(lo), Math.abs(hi)) >= 10000;

  const x = (m: number) => M.left + (m / 36) * plotW;
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * plotH;
  const d = (pts: number[]) => pts.map((v, m) => `${m ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('');

  // End labels: keep them on their lines, push apart only when they'd collide, and draw a leader if moved.
  const ends = series.map(s => ({ ...s, y0: y(s.q.path[36]), ly: 0 })).sort((a, b) => a.y0 - b.y0);
  let prev = -Infinity;
  for (const e of ends) {
    e.ly = Math.max(e.y0, prev + 18);
    prev = e.ly;
  }
  const overflow = ends.length ? ends[ends.length - 1].ly - (M.top + plotH + 6) : 0;
  if (overflow > 0) for (const e of ends) e.ly -= overflow;

  const crossing = pickCrossing(series.map(s => s.q));
  const best = series.find(s => s.q.recommended);

  const toMonth = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    const m = Math.round(((clientX - rect.left - M.left) / plotW) * 36);
    return Math.max(0, Math.min(36, m));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const jump = e.shiftKey ? 6 : 1;
    if (e.key === 'ArrowRight') setHover(h => Math.min(36, (h ?? 0) + jump));
    else if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? 36) - jump));
    else if (e.key === 'Home') setHover(0);
    else if (e.key === 'End') setHover(36);
    else return;
    e.preventDefault();
  };

  const tipLeft = hover === null ? 0 : x(hover);
  const flip = tipLeft > width - 210;

  return (
    <section className="panel cost-chart">
      <div className="panel-head">
        <h4>Your 3 years, month by month</h4>
        <span className="muted small">Hover or use arrow keys</span>
      </div>
      <p className="muted small chart-sub">
        Payments and fees so far, minus what the car would be worth to you. Below $0 means you're ahead. Each line ends at its card's 3-year net
        cost.
      </p>

      <ul className="chart-legend">
        {series.map(s => (
          <li key={s.q.key}>
            <span className="line-key" style={{ background: s.color }} aria-hidden />
            <span>{s.q.title}</span>
            {s.q.recommended && <span className="legend-best">#1 best fit</span>}
          </li>
        ))}
      </ul>

      {crossing && (
        <p className="chart-insight">
          <strong>{crossing.cheaper.title}</strong> becomes cheaper than <strong>{crossing.other.title}</strong>{' '}
          {crossing.month === 36 ? 'at month 36, when the lease-end costs come due' : `from month ${crossing.month} on`}.
        </p>
      )}

      <div
        ref={wrapRef}
        className="chart-wrap"
        tabIndex={0}
        role="group"
        aria-label="Net cost over 36 months for each option. Use the left and right arrow keys to step through months."
        onKeyDown={onKey}
        onFocus={() => setHover(h => h ?? 36)}
        onBlur={() => setHover(null)}
      >
        <svg width={width} height={H} role="img" aria-label={`At 3 years: ${series.map(s => `${s.q.title} ${money(s.q.path[36])}`).join('; ')}`}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-zero' : 'grid'} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">
                {axisMoney(t, compact)}
              </text>
            </g>
          ))}
          {(plotW < 380 ? [0, 12, 24, 36] : [0, 6, 12, 18, 24, 30, 36]).map(m => (
            <text key={m} x={x(m)} y={H - 8} textAnchor={m === 0 ? 'start' : m === 36 ? 'end' : 'middle'} className="tick">
              {monthLabel(m)}
            </text>
          ))}

          {series.map(s => (
            <path key={s.q.key} d={d(s.q.path)} className="series-line" stroke={s.color} />
          ))}

          {/* Ring the crossing named in the insight line; at month 36 the end dots already show it. */}
          {crossing && crossing.month < 36 && (
            <circle className="crossing" cx={x(crossing.month)} cy={y(crossing.cheaper.path[crossing.month])} r={7} />
          )}

          {ends.map(e => (
            <g key={e.q.key}>
              <circle cx={x(36)} cy={e.y0} r={4} fill={e.color} className="end-dot" />
              {showEndLabels && (
                <>
                  {Math.abs(e.ly - e.y0) > 1.5 && <line x1={x(36) + 6} y1={e.y0} x2={x(36) + 12} y2={e.ly} className="leader" />}
                  <text x={x(36) + 14} y={e.ly} dy="0.32em" className="end-label">
                    <tspan className="end-value">{compactMoney(e.q.path[36])}</tspan>
                    <tspan className="end-name" dx="5">
                      {e.name}
                    </tspan>
                  </text>
                </>
              )}
            </g>
          ))}

          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} className="crosshair" />
              {series.map(s => (
                <circle key={s.q.key} cx={x(hover)} cy={y(s.q.path[hover])} r={4} fill={s.color} className="hover-dot" />
              ))}
            </g>
          )}

          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={e => setHover(toMonth(e.clientX, e.currentTarget.ownerSVGElement ?? e.currentTarget))}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {hover !== null && (
          <div className={`chart-tip ${flip ? 'flip' : ''}`} style={{ left: flip ? tipLeft - 12 : tipLeft + 12, top: M.top }} aria-live="polite">
            <div className="tip-head">{hover === 0 ? 'Today' : `Month ${hover}`}</div>
            {series.map(s => (
              <div className="tip-row" key={s.q.key}>
                <span className="line-key" style={{ background: s.color }} aria-hidden />
                <strong>{money(s.q.path[hover])}</strong>
                <span className="muted">{s.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {best && !crossing && (
        <p className="muted small chart-foot">
          No lines cross: the order at 3 years holds the whole way.
        </p>
      )}

      <details className="chart-table">
        <summary>See these numbers as a table</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Month</th>
                {series.map(s => (
                  <th scope="col" key={s.q.key}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series[0].q.path.map((_, m) => (
                <tr key={m}>
                  <th scope="row">{monthLabel(m)}</th>
                  {series.map(s => (
                    <td key={s.q.key}>{money(s.q.path[m])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
