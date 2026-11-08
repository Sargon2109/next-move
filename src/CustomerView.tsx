import { useEffect, useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { ActivityFeed, Controls, ExplanationPanel, Header, LifePanel, OptionCard, SituationStrip, nextStepCopy } from './components';
import {
  byStableOrder,
  goTo,
  money,
  situationOf,
  vehicleName,
  withSituation,
  type Activity,
  type Explanation,
  type Offer,
  type Profile,
  type Quote,
  type Room,
} from './lib';

const ROOM_KEY = 'next-move/customer-room';

function savedRoom(): bigint | null {
  try {
    const v = localStorage.getItem(ROOM_KEY);
    return v ? BigInt(v) : null;
  } catch {
    return null;
  }
}
function saveRoom(id: bigint | null) {
  try {
    if (id === null) localStorage.removeItem(ROOM_KEY);
    else localStorage.setItem(ROOM_KEY, id.toString());
  } catch {
    /* ignore */
  }
}

export default function CustomerView() {
  const { identity } = useSpacetimeDB();
  const [profiles, profilesReady] = useTable(tables.profile);
  const [rooms, roomsReady] = useTable(tables.room);
  const [quotes] = useTable(tables.quote);
  const [offers] = useTable(tables.offer);
  const [explanations] = useTable(tables.explanation);
  const [activity] = useTable(tables.activity);

  const startSession = useReducer(reducers.startSession);
  const requestSpecialist = useReducer(reducers.requestSpecialist);
  const focusOption = useReducer(reducers.focusOption);
  const chooseOption = useReducer(reducers.chooseOption);
  const respondOffer = useReducer(reducers.respondOffer);
  const reopenRoom = useReducer(reducers.reopenRoom);

  const [roomId, setRoomId] = useState<bigint | null>(savedRoom);
  const [pending, setPending] = useState<{ profileId: number; after: bigint } | null>(null);

  // After starting a session, grab the new room as soon as it syncs in.
  useEffect(() => {
    if (!pending || !identity) return;
    const mine = rooms.filter(r => r.customer.isEqual(identity) && r.profileId === pending.profileId && r.id > pending.after);
    if (mine.length > 0) {
      const newest = mine.reduce((a, b) => (a.id > b.id ? a : b));
      setRoomId(newest.id);
      saveRoom(newest.id);
      setPending(null);
    }
  }, [rooms, pending, identity]);

  const room = rooms.find(r => r.id === roomId);

  // The room was wiped (demo reset): go back to the picker.
  useEffect(() => {
    if (roomsReady && roomId !== null && !room && !pending) {
      setRoomId(null);
      saveRoom(null);
    }
  }, [roomsReady, roomId, room, pending]);

  const profile = room ? profiles.find(p => p.id === room.profileId) : undefined;

  const begin = (p: Profile) => {
    const maxId = rooms.reduce((m, r) => (r.id > m ? r.id : m), 0n);
    setPending({ profileId: p.id, after: maxId });
    void startSession({ profileId: p.id }).catch(err => {
      console.error(err);
      setPending(null);
    });
  };

  const leave = () => {
    setRoomId(null);
    saveRoom(null);
  };

  if (!room || !profile) {
    return (
      <div className="app">
        <Header subtitle="Your Toyota, your next move" right={<RoleSwitch />} />
        <Picker profiles={profiles} ready={profilesReady} pendingId={pending?.profileId} onPick={begin} />
      </div>
    );
  }

  return (
    <CustomerRoom
      room={room}
      profile={profile}
      quotes={quotes.filter(q => q.roomId === room.id)}
      offers={offers.filter(o => o.roomId === room.id)}
      explanation={explanations.find(e => e.roomId === room.id)}
      activity={activity.filter(a => a.roomId === room.id)}
      onLeave={leave}
      onRequest={() => void requestSpecialist({ roomId: room.id }).catch(console.error)}
      onFocus={key => void focusOption({ roomId: room.id, key }).catch(console.error)}
      onChoose={key => {
        void chooseOption({ roomId: room.id, key }).catch(console.error);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      onRespond={(offerId, accept) => void respondOffer({ offerId, accept }).catch(console.error)}
      onReopen={() => void reopenRoom({ roomId: room.id }).catch(console.error)}
    />
  );
}

function RoleSwitch() {
  return (
    <button className="btn btn-ghost small" onClick={() => goTo('#/rep')}>
      Specialist view
    </button>
  );
}

// ---------------------------------------------------------------------------

function Picker({
  profiles,
  ready,
  pendingId,
  onPick,
}: {
  profiles: readonly Profile[];
  ready: boolean;
  pendingId?: number;
  onPick: (p: Profile) => void;
}) {
  const sorted = [...profiles].sort((a, b) => a.id - b.id);
  return (
    <main className="picker">
      <div className="picker-hero">
        <p className="eyebrow">Toyota Financial Services · HackUTD 2026</p>
        <h1>
          Given your situation today, what's the smartest next move for you and your Toyota?
        </h1>
        <p className="lead">
          Pick a customer to step into their shoes. Every option is calculated from their real contract numbers, explained in plain
          English, and a specialist can join the same screen live.
        </p>
      </div>
      {!ready && <p className="muted">Loading customers…</p>}
      <div className="persona-grid">
        {sorted.map(p => {
          const s = situationOf(p);
          return (
            <button key={p.id} className="persona" onClick={() => onPick(p)} disabled={pendingId !== undefined}>
              <div className="persona-top">
                <div className="avatar">{p.firstName[0]}</div>
                <div>
                  <div className="persona-name">{p.firstName}</div>
                  <div className="muted small">{p.city}</div>
                </div>
              </div>
              <div className="persona-car">{vehicleName(p)}</div>
              <div className="persona-contract">
                {p.contractType === 'lease' ? `Lease · ${s.monthsLeft} months left` : `Loan · ${p.apr}% APR`} ·{' '}
                {money(p.monthlyPayment)}/mo
              </div>
              <div className="persona-event">{p.lifeEvent}</div>
              <span className="persona-cta">{pendingId === p.id ? 'Opening…' : `Start as ${p.firstName} →`}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small center">All customers and contracts are synthetic demo data.</p>
    </main>
  );
}

// ---------------------------------------------------------------------------

function CustomerRoom({
  room,
  profile,
  quotes,
  offers,
  explanation,
  activity,
  onLeave,
  onRequest,
  onFocus,
  onChoose,
  onRespond,
  onReopen,
}: {
  room: Room;
  profile: Profile;
  quotes: Quote[];
  offers: Offer[];
  explanation?: Explanation;
  activity: Activity[];
  onLeave: () => void;
  onRequest: () => void;
  onFocus: (key: string) => void;
  onChoose: (key: string) => void;
  onRespond: (offerId: bigint, accept: boolean) => void;
  onReopen: () => void;
}) {
  const roomQuotes = useMemo(() => [...quotes].sort(byStableOrder), [quotes]);
  const live = useMemo(() => withSituation(profile, room), [profile, room]);
  const pendingOffers = offers.filter(o => o.status === 'pending');
  const chosen = roomQuotes.find(q => q.key === room.chosenOption);
  const hasSpecialist = room.specialist !== undefined && room.specialistName !== '';

  return (
    <div className="app">
      <Header
        subtitle="Your Toyota, your next move"
        right={
          <>
            <span className="code-chip">Room {room.code}</span>
            <button className="btn btn-ghost small" onClick={onLeave}>
              Switch customer
            </button>
          </>
        }
      />
      <main className="layout">
        <div className="hero">
          <h1>Hi {profile.firstName}. Here are your real options.</h1>
          <p className="muted">
            {profile.persona} · {profile.city}
          </p>
        </div>

        {room.status === 'decided' && chosen && (
          <section className="decision">
            <div>
              <span className="chip good">{nextStepCopy(chosen).badge}</span>
              <h2>
                You chose: {chosen.title} at {money(chosen.monthly)}/mo
              </h2>
              <p>
                <strong>{nextStepCopy(chosen).headline}.</strong> {chosen.nextStepLabel}.
              </p>
            </div>
            <button className="btn btn-ghost" onClick={onReopen}>
              Change my mind
            </button>
          </section>
        )}

        <SituationStrip profile={live} driving={room.driving} />

        <div className="grid-main">
          <div className="options">
            {roomQuotes.map(q => (
              <OptionCard
                key={q.key}
                quote={q}
                profile={live}
                focused={room.focusedOption === q.key}
                chosen={room.chosenOption === q.key}
                onFocus={() => onFocus(q.key)}
                onChoose={() => onChoose(q.key)}
              />
            ))}
          </div>

          <aside className="side">
            <section className={`panel specialist ${room.status}`}>
              {room.status === 'self_serve' && !hasSpecialist && (
                <>
                  <div className="panel-head">
                    <h4>Want a second opinion?</h4>
                  </div>
                  <p className="muted">
                    A Toyota Financial specialist can join this screen live and see exactly what you see. No phone tag, no starting over.
                  </p>
                  <button className="btn btn-primary wide" onClick={onRequest}>
                    Bring in a specialist
                  </button>
                </>
              )}
              {room.status === 'waiting' && (
                <>
                  <div className="panel-head">
                    <h4>Finding a specialist…</h4>
                    <span className="spinner" />
                  </div>
                  <p className="muted">
                    Your room code is <strong>{room.code}</strong>. They'll see your numbers the moment they join.
                  </p>
                </>
              )}
              {hasSpecialist && room.status !== 'waiting' && (
                <>
                  <div className="specialist-row">
                    <div className="avatar blue">{room.specialistName[0]}</div>
                    <div>
                      <div className="strong">{room.specialistName} is here with you</div>
                      <div className="muted small">Toyota Financial Services · seeing your screen live</div>
                    </div>
                    <span className="live-dot" />
                  </div>
                </>
              )}
            </section>

            <LifePanel room={room} profile={profile} title="What's changed in your life?" hint="Watch the best fit move" />
            <Controls room={room} title="Try different numbers" hint="Updates instantly" />
            <ExplanationPanel room={room} explanation={explanation} />
            {hasSpecialist && <ActivityFeed items={activity} />}
          </aside>
        </div>
      </main>

      {pendingOffers.length > 0 && (
        <div className="toasts">
          {pendingOffers.map(o => (
            <div className="toast" key={String(o.id)}>
              <div className="toast-eyebrow">{o.sentBy} sent you an offer</div>
              <div className="toast-title">{o.title}</div>
              <div className="muted small">{o.detail}</div>
              <div className="toast-actions">
                <button className="btn btn-primary" onClick={() => onRespond(o.id, true)}>
                  Apply it
                </button>
                <button className="btn btn-ghost" onClick={() => onRespond(o.id, false)}>
                  No thanks
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
