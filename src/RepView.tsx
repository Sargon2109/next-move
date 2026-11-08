import { useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { ActivityFeed, Controls, ExplanationPanel, Header, LifePanel, OptionCard, SituationStrip } from './components';
import { CostChart, seriesColor } from './CostChart';
import { byStableOrder, goTo, money, timeAgo, useNow, vehicleName, withSituation, type OfferTemplate, type Room } from './lib';

const NAME_KEY = 'next-move/specialist-name';

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Jordan';
  } catch {
    return 'Jordan';
  }
}

export default function RepView() {
  const { identity } = useSpacetimeDB();
  const now = useNow(5000);
  const [profiles] = useTable(tables.profile);
  const [rooms] = useTable(tables.room);
  const [quotes] = useTable(tables.quote);
  const [offers] = useTable(tables.offer);
  const [templates] = useTable(tables.offerTemplate);
  const [explanations] = useTable(tables.explanation);
  const [activity] = useTable(tables.activity);
  const [moments] = useTable(tables.moment);

  const joinRoom = useReducer(reducers.joinRoom);
  const sendOffer = useReducer(reducers.sendOffer);
  const resetDemo = useReducer(reducers.resetDemo);

  const [name, setName] = useState(savedName);
  const [selected, setSelected] = useState<bigint | null>(null);

  const profileOf = (r: Room) => profiles.find(p => p.id === r.profileId);
  const isMine = (r: Room) => !!identity && !!r.specialist && r.specialist.isEqual(identity);

  const waiting = rooms.filter(r => r.status === 'waiting').sort((a, b) => Number(a.id - b.id));
  const mine = rooms.filter(isMine).sort((a, b) => Number(b.id - a.id));
  const browsing = rooms.filter(r => r.status === 'self_serve' && !r.specialist).sort((a, b) => Number(b.id - a.id));
  const room = rooms.find(r => r.id === selected);
  const profile = room ? profileOf(room) : undefined;
  const live = room && profile ? withSituation(profile, room) : undefined;

  const join = (r: Room) => {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
    setSelected(r.id);
    void joinRoom({ roomId: r.id, name }).catch(console.error);
  };

  const roomQuotes = useMemo(
    () => (room ? quotes.filter(q => q.roomId === room.id).sort(byStableOrder) : []),
    [quotes, room]
  );
  const roomOffers = room ? offers.filter(o => o.roomId === room.id) : [];
  const roomTemplates = profile ? templates.filter(t => t.profileId === profile.id).sort((a, b) => a.id - b.id) : [];
  const focused = roomQuotes.find(q => q.key === room?.focusedOption);
  const best = roomQuotes.find(q => q.recommended);

  const offerState = (t: OfferTemplate) => {
    const sent = roomOffers.filter(o => o.templateId === t.id).sort((a, b) => Number(b.id - a.id))[0];
    return sent?.status;
  };

  return (
    <div className="app rep">
      <Header
        subtitle="Specialist console"
        right={
          <>
            <label className="name-field">
              <span>You are</span>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={40} />
            </label>
            <button className="btn btn-ghost small" onClick={() => goTo('#/customer')}>
              Customer view
            </button>
          </>
        }
      />
      <div className="rep-layout">
        <nav className="queue">
          <QueueSection title="Waiting for you" count={waiting.length} tone="hot">
            {waiting.length === 0 && <p className="muted small">No one is waiting.</p>}
            {waiting.map(r => (
              <QueueItem key={String(r.id)} room={r} name={profileOf(r)?.firstName} active={r.id === selected} label="Join" onClick={() => join(r)} now={now} />
            ))}
          </QueueSection>

          <QueueSection title="Your live sessions" count={mine.length}>
            {mine.length === 0 && <p className="muted small">Join someone to start.</p>}
            {mine.map(r => (
              <QueueItem key={String(r.id)} room={r} name={profileOf(r)?.firstName} active={r.id === selected} label="Open" onClick={() => setSelected(r.id)} now={now} />
            ))}
          </QueueSection>

          <QueueSection title="Browsing on their own" count={browsing.length}>
            {browsing.length === 0 && <p className="muted small">Nobody right now.</p>}
            {browsing.map(r => (
              <QueueItem key={String(r.id)} room={r} name={profileOf(r)?.firstName} active={r.id === selected} label="Offer help" onClick={() => join(r)} now={now} />
            ))}
          </QueueSection>

          <QueueSection title="Moments that matter" count={moments.length}>
            <p className="muted tiny">Found by a scheduled scan of every contract.</p>
            {[...moments]
              .sort((a, b) => b.priority - a.priority)
              .map(m => (
                <div className="moment" key={m.profileId}>
                  <div className="moment-head">
                    <strong>{m.firstName}</strong>
                    <span className="muted tiny">scanned {timeAgo(m.scannedAt, now)}</span>
                  </div>
                  <div className="moment-headline">{m.headline}</div>
                  <div className="muted small">{m.detail}</div>
                </div>
              ))}
          </QueueSection>

          <button
            className="btn btn-ghost small wide reset"
            onClick={() => {
              if (window.confirm('Clear every session for a fresh demo?')) {
                setSelected(null);
                void resetDemo().catch(console.error);
              }
            }}
          >
            Reset demo
          </button>
        </nav>

        <main className="rep-main">
          {!room || !profile || !live ? (
            <div className="empty">
              <h2>Pick a customer from the queue</h2>
              <p className="muted">When you join, you see exactly what they see, live. Move a slider here and it moves on their screen too.</p>
            </div>
          ) : (
            <>
              <div className="rep-title">
                <div>
                  <h1>
                    {profile.firstName} <span className="muted">· {vehicleName(profile)}</span>
                  </h1>
                  <p className="muted">
                    Room {room.code} · {profile.creditTier} · budget {money(live.monthlyBudget)}/mo
                  </p>
                </div>
                <span className={`status-pill ${room.status}`}>{statusLabel(room.status)}</span>
              </div>

              <div className="watching">
                <span className="live-dot" />
                {room.status === 'decided' && room.chosenOption
                  ? `${profile.firstName} chose “${roomQuotes.find(q => q.key === room.chosenOption)?.title ?? room.chosenOption}”`
                  : focused
                    ? `${profile.firstName} is looking at “${focused.title}”`
                    : `${profile.firstName}'s screen is live`}
                {best && <span className="muted"> · Best fit right now: {best.title}</span>}
              </div>

              <SituationStrip profile={live} driving={room.driving} />

              <div className="grid-main">
                <div className="main-col">
                  <div className="options">
                    {roomQuotes.map((q, i) => (
                      <OptionCard
                        key={q.key}
                        quote={q}
                        profile={live}
                        color={seriesColor(i)}
                        focused={room.focusedOption === q.key}
                        focusLabel={`${profile.firstName} is looking at this`}
                        chosen={room.chosenOption === q.key}
                      />
                    ))}
                  </div>
                  <CostChart quotes={roomQuotes} />
                </div>
                <aside className="side">
                  <section className="panel">
                    <div className="panel-head">
                      <h4>Offers you can send</h4>
                      <span className="muted small">Eligible for {profile.firstName}</span>
                    </div>
                    <ul className="offer-list">
                      {roomTemplates.map(t => {
                        const state = offerState(t);
                        const offModel = t.forModel !== '' && t.forModel !== live.upgradeModel;
                        return (
                          <li key={t.id} className={offModel ? 'off-model' : ''}>
                            <div>
                              <div className="strong">{t.title}</div>
                              <div className="muted small">{offModel ? `Only for the ${t.forModel}, not the ${live.upgradeModel}` : t.detail}</div>
                            </div>
                            {state === 'accepted' ? (
                              <span className="chip good">Applied</span>
                            ) : state === 'pending' ? (
                              <span className="chip">Sent</span>
                            ) : (
                              <button
                                className="btn btn-soft small"
                                disabled={offModel}
                                onClick={() => void sendOffer({ roomId: room.id, templateId: t.id }).catch(console.error)}
                              >
                                {state === 'declined' ? 'Resend' : 'Send'}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                  <LifePanel room={room} profile={profile} title={`${profile.firstName}'s situation`} hint="Changes on both screens" />
                  <Controls room={room} title="Show a different scenario" hint={`Moves ${profile.firstName}'s screen too`} />
                  <ExplanationPanel room={room} explanation={explanations.find(e => e.roomId === room.id)} />
                  <ActivityFeed items={activity.filter(a => a.roomId === room.id)} />
                </aside>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function statusLabel(s: string) {
  return { self_serve: 'Browsing', waiting: 'Waiting', live: 'Live together', decided: 'Decided' }[s] ?? s;
}

function QueueSection({ title, count, tone, children }: { title: string; count: number; tone?: string; children: React.ReactNode }) {
  return (
    <section className={`queue-section ${tone ?? ''}`}>
      <div className="queue-title">
        <span>{title}</span>
        <span className="count">{count}</span>
      </div>
      {children}
    </section>
  );
}

function QueueItem({
  room,
  name,
  active,
  label,
  onClick,
  now,
}: {
  room: Room;
  name?: string;
  active: boolean;
  label: string;
  onClick: () => void;
  now: number;
}) {
  return (
    <div className={`queue-item ${active ? 'active' : ''}`}>
      <div className="avatar small">{name?.[0] ?? '?'}</div>
      <div className="queue-item-body">
        <div className="strong">{name ?? 'Customer'}</div>
        <div className="muted tiny">
          {room.code} · {timeAgo(room.updatedAt, now)}
        </div>
      </div>
      <button className="btn btn-soft small" onClick={onClick}>
        {label}
      </button>
    </div>
  );
}
