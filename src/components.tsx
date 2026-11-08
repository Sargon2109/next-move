import { useEffect, useRef, useState } from 'react';
import { useProcedure, useReducer, useSpacetimeDB } from 'spacetimedb/react';
import { procedures, reducers } from './module_bindings';
import {
  TERMS,
  clockTime,
  money,
  situationOf,
  useAnimatedNumber,
  vehicleName,
  type Activity,
  type Explanation,
  type Profile,
  type Quote,
  type Room,
} from './lib';

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function Header({ subtitle, right }: { subtitle: string; right?: React.ReactNode }) {
  const { isActive } = useSpacetimeDB();
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo" aria-hidden>
          <span />
        </div>
        <div>
          <div className="brand-name">Next Move</div>
          <div className="brand-sub">{subtitle}</div>
        </div>
      </div>
      <div className="topbar-right">
        {right}
        <span className={`conn ${isActive ? 'on' : 'off'}`}>
          <i />
          {isActive ? 'Live' : 'Connecting'}
        </span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Where the customer stands today
// ---------------------------------------------------------------------------

export function SituationStrip({ profile }: { profile: Profile }) {
  const s = situationOf(profile);
  const isLease = profile.contractType === 'lease';
  const items: { label: string; value: string; tone?: string }[] = [
    { label: 'Vehicle', value: vehicleName(profile) },
    {
      label: isLease ? 'Lease' : 'Loan',
      value: isLease ? `${s.monthsLeft} months left` : `${s.monthsLeft} payments left at ${profile.apr}%`,
    },
    { label: 'Payment today', value: `${money(profile.monthlyPayment)}/mo` },
    { label: 'Equity today', value: money(s.equity), tone: s.equity >= 0 ? 'good' : 'bad' },
  ];
  if (isLease) {
    items.push(
      s.milesOver > 0
        ? { label: 'Miles', value: `Trending ${s.milesOver.toLocaleString()} over`, tone: 'warn' }
        : { label: 'Miles', value: `${s.milesUnder.toLocaleString()} under`, tone: 'good' }
    );
  } else {
    items.push({ label: 'Credit', value: profile.creditTier, tone: 'good' });
  }
  items.push({ label: 'Budget', value: `${money(profile.monthlyBudget)}/mo` });

  return (
    <section className="situation">
      <div className="life-event">
        <span className="pulse-dot" />
        {profile.lifeEvent}
      </div>
      <div className="facts">
        {items.map(i => (
          <div className={`fact ${i.tone ?? ''}`} key={i.label}>
            <div className="fact-label">{i.label}</div>
            <div className="fact-value">{i.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One option card
// ---------------------------------------------------------------------------

function Num({ value, className }: { value: number; className?: string }) {
  const v = useAnimatedNumber(value);
  return <span className={className}>{money(v)}</span>;
}

export function OptionCard({
  quote,
  profile,
  focused,
  focusLabel,
  chosen,
  onFocus,
  onChoose,
  chooseLabel = 'Choose this',
}: {
  quote: Quote;
  profile: Profile;
  focused: boolean;
  focusLabel?: string;
  chosen: boolean;
  onFocus?: () => void;
  onChoose?: () => void;
  chooseLabel?: string;
}) {
  const over = Math.max(quote.monthly, quote.monthlyLater) - profile.monthlyBudget;
  const flash = useFlashOnChange(Math.round(quote.monthly));
  return (
    <article
      className={`option ${quote.recommended ? 'best' : ''} ${focused ? 'focused' : ''} ${chosen ? 'chosen' : ''} ${flash ? 'flash' : ''}`}
      onClick={onFocus}
    >
      {focused && focusLabel && <div className="focus-tag">{focusLabel}</div>}
      <div className="option-top">
        <div className={`rank ${quote.recommended ? 'rank-best' : ''}`}>
          {quote.recommended ? `#1 Best fit · ${quote.confidence} confidence` : `#${quote.rank}`}
        </div>
        {quote.appliedOffers.length > 0 && (
          <div className="offer-chips">
            {quote.appliedOffers.map(o => (
              <span className="chip offer" key={o}>
                {o}
              </span>
            ))}
          </div>
        )}
      </div>
      <h3>{quote.title}</h3>
      <p className="option-sub">{quote.subtitle}</p>

      <div className="price">
        <Num value={quote.monthly} className="price-big" />
        <span className="price-unit">/mo</span>
      </div>
      {quote.monthlyLater > 0 && (
        <div className="price-later">
          then about <Num value={quote.monthlyLater} />
          /mo after your lease ends
        </div>
      )}

      <div className="mini-stats">
        <div>
          <span>Due now</span>
          <Num value={quote.dueNow} />
        </div>
        <div title="Payments and fees over 3 years, minus what your car is worth to you at the end">
          <span>3-year net cost</span>
          <Num value={quote.net36} />
        </div>
      </div>

      <div className="fit-row">
        <span className={`chip ${quote.fitsBudget ? 'good' : 'bad'}`}>
          {quote.fitsBudget ? 'Fits budget' : `${money(over)}/mo over budget`}
        </span>
        <span className={`chip ${quote.fitsLife ? 'good' : 'bad'}`}>
          {quote.fitsLife ? 'Fits your life' : profile.needsSpace ? 'No extra room' : 'Weak fit'}
        </span>
      </div>

      <ul className="pc">
        {quote.pros.slice(0, 3).map(p => (
          <li className="pro" key={p}>
            {p}
          </li>
        ))}
        {quote.cons.slice(0, 2).map(c => (
          <li className="con" key={c}>
            {c}
          </li>
        ))}
      </ul>

      <details className="assumptions" onClick={e => e.stopPropagation()}>
        <summary>How we got these numbers</summary>
        <ul>
          {quote.assumptions.map(a => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>

      {onChoose && (
        <button
          className={`btn ${quote.recommended ? 'btn-primary' : 'btn-ghost'} wide`}
          onClick={e => {
            e.stopPropagation();
            onChoose();
          }}
        >
          {chosen ? 'Chosen' : chooseLabel}
        </button>
      )}
    </article>
  );
}

function useFlashOnChange(value: number): boolean {
  const [flash, setFlash] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(id);
  }, [value]);
  return flash;
}

// ---------------------------------------------------------------------------
// Sliders: down payment + term. Both screens can drive them.
// ---------------------------------------------------------------------------

export function Controls({ room, title, hint }: { room: Room; title: string; hint?: string }) {
  const update = useReducer(reducers.updateInputs);
  const [down, setDown] = useState(room.downPayment);
  const dragging = useRef(false);
  const lastSent = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow changes made by the other screen, unless we are the one dragging.
  useEffect(() => {
    if (!dragging.current) setDown(room.downPayment);
  }, [room.downPayment]);

  const send = (downPayment: number, financeTerm: number) => {
    void update({ roomId: room.id, downPayment, financeTerm }).catch(console.error);
  };

  const onSlide = (v: number) => {
    setDown(v);
    const now = Date.now();
    if (pending.current) clearTimeout(pending.current);
    if (now - lastSent.current > 90) {
      lastSent.current = now;
      send(v, room.financeTerm);
    } else {
      pending.current = setTimeout(() => send(v, room.financeTerm), 90);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h4>{title}</h4>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      <label className="slider-label">
        <span>Down payment</span>
        <strong>{money(down)}</strong>
      </label>
      <input
        type="range"
        min={0}
        max={10000}
        step={500}
        value={down}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={() => {
          dragging.current = false;
          send(down, room.financeTerm);
        }}
        onChange={e => onSlide(Number(e.target.value))}
        aria-label="Down payment"
      />
      <div className="slider-scale">
        <span>$0</span>
        <span>$10,000</span>
      </div>

      <div className="slider-label" style={{ marginTop: 16 }}>
        <span>Finance term</span>
        <strong>{room.financeTerm} months</strong>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Finance term">
        {TERMS.map(t => (
          <button
            key={t}
            role="radio"
            aria-checked={room.financeTerm === t}
            className={room.financeTerm === t ? 'on' : ''}
            onClick={() => send(down, t)}
          >
            {t}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plain-English explanation (AI when available, rules otherwise)
// ---------------------------------------------------------------------------

export function ExplanationPanel({ room, explanation }: { room: Room; explanation?: Explanation }) {
  const explain = useProcedure(procedures.explainRoom);
  const [asked, setAsked] = useState(false);
  if (!explanation) return null;

  const aiFresh = explanation.aiText && explanation.aiVersion === room.version;
  const aiStale = explanation.aiText && explanation.aiVersion !== room.version;
  const thinking = explanation.status === 'thinking';
  const text = aiFresh ? explanation.aiText : explanation.rulesText;

  return (
    <section className={`panel explain ${thinking ? 'thinking' : ''}`}>
      <div className="panel-head">
        <h4>Why this is the best fit</h4>
        <span className={`source ${aiFresh ? 'ai' : ''}`}>{aiFresh ? `AI · ${shortModel(explanation.aiModel)}` : 'Calculated'}</span>
      </div>
      <p className="explain-text">{thinking ? 'Thinking it through with your numbers…' : text}</p>
      {aiStale && !thinking && <p className="muted small">Numbers changed since the AI wrote this. Ask again for an updated take.</p>}
      {explanation.status === 'error' && asked && <p className="muted small">AI is unavailable right now, so this summary comes straight from the math.</p>}
      <div className="explain-foot">
        <span className="muted small">Every number comes from the calculator. The AI only explains it.</span>
        <button
          className="btn btn-soft"
          disabled={thinking}
          onClick={() => {
            setAsked(true);
            void explain({ roomId: room.id }).catch(console.error);
          }}
        >
          {thinking ? 'Thinking…' : aiFresh ? 'Ask again' : 'Explain it like a person'}
        </button>
      </div>
    </section>
  );
}

function shortModel(m: string): string {
  const last = m.split('/').pop() ?? m;
  return last.length > 28 ? `${last.slice(0, 26)}…` : last;
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export function ActivityFeed({ items, title = 'Session activity' }: { items: Activity[]; title?: string }) {
  const sorted = [...items].sort((a, b) => Number(b.id - a.id)).slice(0, 8);
  return (
    <section className="panel">
      <div className="panel-head">
        <h4>{title}</h4>
      </div>
      {sorted.length === 0 ? (
        <p className="muted small">Nothing yet.</p>
      ) : (
        <ol className="feed">
          {sorted.map(a => (
            <li key={String(a.id)} className={`feed-${a.actor}`}>
              <span className="feed-time">{clockTime(a.at)}</span>
              <span>{a.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function nextStepCopy(q: Quote): { badge: string; headline: string } {
  if (q.nextStep === 'offer') return { badge: 'Offer applied', headline: 'Your specialist will lock in this offer' };
  if (q.nextStep === 'follow_up') return { badge: 'Specialist follow-up', headline: 'A specialist takes it from here' };
  return { badge: 'Self-service', headline: 'You can do this yourself in a few minutes' };
}
