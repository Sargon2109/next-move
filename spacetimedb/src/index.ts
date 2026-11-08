import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import {
  applySituation,
  buildQuotes,
  drivingFactor,
  money,
  rulesExplanation,
  situation,
  DRIVING_FACTORS,
  HORIZON_MONTHS,
  type AcceptedOffer,
} from './finance';
import { callChat } from './llm';
import { OFFER_TEMPLATES, PROFILES } from './seed';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const profile = table(
  { name: 'profile', public: true },
  {
    id: t.u32().primaryKey(),
    firstName: t.string(),
    city: t.string(),
    persona: t.string(),
    lifeEvent: t.string(),
    needsSpace: t.bool(),
    monthlyBudget: t.f64(),
    creditTier: t.string(),
    contractType: t.string(),
    vehicleYear: t.u32(),
    vehicleModel: t.string(),
    vehicleTrim: t.string(),
    monthlyPayment: t.f64(),
    termMonths: t.u32(),
    monthsElapsed: t.u32(),
    apr: t.f64(),
    balance: t.f64(),
    residual: t.f64(),
    marketValue: t.f64(),
    currentMiles: t.u32(),
    milesPerYear: t.u32(),
    overageRate: t.f64(),
    upgradeModel: t.string(),
    upgradePrice: t.f64(),
    upgradeAddsSpace: t.bool(),
    roomyModel: t.string(),
    roomyPrice: t.f64(),
    newApr: t.f64(),
    usedApr: t.f64(),
    replacementLease: t.f64(),
  }
);

// A live session. The customer and the specialist both subscribe to it.
const room = table(
  { name: 'room', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string().unique(),
    profileId: t.u32(),
    customer: t.identity(),
    specialist: t.option(t.identity()),
    specialistName: t.string(),
    status: t.string(), // self_serve | waiting | live | decided
    downPayment: t.f64(),
    financeTerm: t.u32(),
    // The customer's life situation for this session (starts from the profile, either screen can change it).
    budget: t.f64(),
    needsSpace: t.bool(),
    driving: t.string(), // less | same | more
    focusedOption: t.string(),
    chosenOption: t.string(),
    version: t.u32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

// Every option's numbers, recalculated by reducers whenever inputs or offers change.
const quote = table(
  { name: 'quote', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    key: t.string(),
    title: t.string(),
    subtitle: t.string(),
    monthly: t.f64(),
    monthlyLater: t.f64(),
    dueNow: t.f64(),
    cashOut36: t.f64(),
    equity36: t.f64(),
    net36: t.f64(),
    fitsBudget: t.bool(),
    fitsLife: t.bool(),
    recommended: t.bool(),
    rank: t.u32(),
    confidence: t.string(),
    pros: t.array(t.string()),
    cons: t.array(t.string()),
    assumptions: t.array(t.string()),
    nextStep: t.string(),
    nextStepLabel: t.string(),
    appliedOffers: t.array(t.string()),
  }
);

const explanation = table(
  { name: 'explanation', public: true },
  {
    roomId: t.u64().primaryKey(),
    rulesText: t.string(), // always current, deterministic
    aiText: t.string(),
    aiModel: t.string(),
    aiVersion: t.u32(), // room.version the AI text was written for
    status: t.string(), // idle | thinking | ready | error
    error: t.string(),
    updatedAt: t.timestamp(),
  }
);

const offerTemplate = table(
  { name: 'offer_template', public: true },
  {
    id: t.u32().primaryKey(),
    profileId: t.u32().index('btree'),
    title: t.string(),
    detail: t.string(),
    kind: t.string(),
    amount: t.f64(),
    appliesTo: t.string(),
    forModel: t.string(), // '' = any model
    maxTerm: t.u32(),
  }
);

const offer = table(
  { name: 'offer', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    templateId: t.u32(),
    title: t.string(),
    detail: t.string(),
    kind: t.string(),
    amount: t.f64(),
    appliesTo: t.string(),
    forModel: t.string(),
    maxTerm: t.u32(),
    status: t.string(), // pending | accepted | declined
    sentBy: t.string(),
    createdAt: t.timestamp(),
  }
);

const activity = table(
  { name: 'activity', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomId: t.u64().index('btree'),
    actor: t.string(), // customer | specialist | system
    text: t.string(),
    at: t.timestamp(),
  }
);

// "Moments that matter" queue for specialists, refreshed by a scheduled scan.
const moment = table(
  { name: 'moment', public: true },
  {
    profileId: t.u32().primaryKey(),
    firstName: t.string(),
    headline: t.string(),
    detail: t.string(),
    priority: t.u32(),
    scannedAt: t.timestamp(),
  }
);

const momentTimer = table(
  { name: 'moment_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// Private: never sent to clients.
const llmConfig = table(
  { name: 'llm_config', public: false },
  {
    id: t.u32().primaryKey(),
    admin: t.identity(),
    endpoint: t.string(),
    apiKey: t.string(),
    model: t.string(),
  }
);

const spacetimedb = schema({
  profile,
  room,
  quote,
  explanation,
  offerTemplate,
  offer,
  activity,
  moment,
  momentTimer,
  llmConfig,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type RoomRow = ReturnType<typeof getRoom>;

// ---------------------------------------------------------------------------
// Helpers (not exported: only registered functions are exported)
// ---------------------------------------------------------------------------

function getRoom(ctx: Ctx, roomId: bigint) {
  const r = ctx.db.room.id.find(roomId);
  if (!r) throw new SenderError(`Room ${roomId} not found`);
  return r;
}

function getProfile(ctx: Ctx, profileId: number) {
  const p = ctx.db.profile.id.find(profileId);
  if (!p) throw new SenderError(`Profile ${profileId} not found`);
  return p;
}

function log(ctx: Ctx, roomId: bigint, actor: string, text: string) {
  ctx.db.activity.insert({ id: 0n, roomId, actor, text, at: ctx.timestamp });
}

function actorFor(ctx: Ctx, r: RoomRow): string {
  if (r.specialist && r.specialist.isEqual(ctx.sender)) return 'specialist';
  if (r.customer.isEqual(ctx.sender)) return 'customer';
  return 'specialist';
}

function acceptedOffers(ctx: Ctx, roomId: bigint): AcceptedOffer[] {
  return [...ctx.db.offer.roomId.filter(roomId)]
    .filter(o => o.status === 'accepted')
    .map(o => ({ kind: o.kind, amount: o.amount, appliesTo: o.appliesTo, maxTerm: o.maxTerm, forModel: o.forModel }));
}

// The profile as it stands in this session, after the customer's life changes.
function livingProfile(ctx: Ctx, r: RoomRow) {
  return applySituation(getProfile(ctx, r.profileId), { budget: r.budget, needsSpace: r.needsSpace });
}

const DRIVING_LABELS: Record<string, string> = {
  less: 'driving less from now on',
  same: 'driving about the same',
  more: 'driving more from now on',
};

// Recalculate every option for a room and refresh the rule-based explanation.
function recompute(ctx: Ctx, r: RoomRow) {
  const p = livingProfile(ctx, r);
  const inputs = { downPayment: r.downPayment, financeTerm: r.financeTerm, drivingFactor: drivingFactor(r.driving) };
  const ranked = buildQuotes(p, inputs, acceptedOffers(ctx, r.id));

  const oldQuotes = [...ctx.db.quote.roomId.filter(r.id)];
  const oldBest = oldQuotes.find(q => q.recommended);
  for (const old of oldQuotes) ctx.db.quote.id.delete(old.id);
  for (const q of ranked) ctx.db.quote.insert({ id: 0n, roomId: r.id, ...q });
  if (oldBest && ranked[0] && oldBest.title !== ranked[0].title) {
    log(ctx, r.id, 'system', `New best fit: ${ranked[0].title}`);
  }

  const rulesText = rulesExplanation(p, ranked);
  const existing = ctx.db.explanation.roomId.find(r.id);
  if (existing) {
    ctx.db.explanation.roomId.update({ ...existing, rulesText, updatedAt: ctx.timestamp });
  } else {
    ctx.db.explanation.insert({
      roomId: r.id,
      rulesText,
      aiText: '',
      aiModel: '',
      aiVersion: 0,
      status: 'idle',
      error: '',
      updatedAt: ctx.timestamp,
    });
  }
}

function touch(ctx: Ctx, r: RoomRow, changes: Partial<RoomRow>, bumpVersion: boolean) {
  const next = { ...r, ...changes, updatedAt: ctx.timestamp, version: bumpVersion ? r.version + 1 : r.version };
  ctx.db.room.id.update(next);
  return next;
}

function scan(ctx: Ctx) {
  for (const p of ctx.db.profile.iter()) {
    const s = situation(p);
    const bits: string[] = [];
    let priority = 1;
    let headline = '';
    if (p.contractType === 'lease') {
      headline = `Lease ends in ${s.monthsLeft} months`;
      if (s.monthsLeft <= 6) priority += 2;
      else if (s.monthsLeft <= 9) priority += 1;
      if (s.equityToday > 0) bits.push(`${money(s.equityToday)} positive equity`);
      if (s.milesOver > 0) {
        bits.push(`trending ${s.milesOver.toLocaleString('en-US')} mi over`);
        priority += 1;
      }
      if (s.milesUnder > 3000) bits.push(`${s.milesUnder.toLocaleString('en-US')} mi under allowance`);
    } else {
      headline = `Paying ${p.apr.toFixed(1)}% APR on a ${p.vehicleModel}`;
      if (p.apr - p.usedApr >= 2) {
        bits.push(`credit improved, could refinance near ${p.usedApr.toFixed(2)}%`);
        priority += 2;
      }
      if (s.equityToday > 0) bits.push(`${money(s.equityToday)} positive equity`);
    }
    bits.push(p.lifeEvent.toLowerCase());
    const row = {
      profileId: p.id,
      firstName: p.firstName,
      headline,
      detail: bits.join(' · '),
      priority,
      scannedAt: ctx.timestamp,
    };
    if (ctx.db.moment.profileId.find(p.id)) ctx.db.moment.profileId.update(row);
    else ctx.db.moment.insert(row);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const init = spacetimedb.init(ctx => {
  for (const p of PROFILES) ctx.db.profile.insert(p);
  for (const o of OFFER_TEMPLATES) ctx.db.offerTemplate.insert(o);
  ctx.db.momentTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(30_000_000n) });
  scan(ctx);
});

export const onConnect = spacetimedb.clientConnected(_ctx => {});
export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

// Runs every 30 seconds: the "nightly scan" that finds customers at a decision moment.
export const scanMoments = spacetimedb.reducer({ onSchedule: momentTimer }, { timer: momentTimer.rowType }, (ctx, _args) => {
  scan(ctx);
});

// ---------------------------------------------------------------------------
// Customer + specialist actions
// ---------------------------------------------------------------------------

export const startSession = spacetimedb.reducer({ profileId: t.u32() }, (ctx, { profileId }) => {
  const p = getProfile(ctx, profileId);
  let code = '';
  for (let i = 0; i < 20; i++) {
    const candidate = `${p.vehicleModel.slice(0, 3).toUpperCase()}-${ctx.random.integerInRange(100, 999)}`;
    if (!ctx.db.room.code.find(candidate)) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new SenderError('Could not create a room code, try again');

  const r = ctx.db.room.insert({
    id: 0n,
    code,
    profileId,
    customer: ctx.sender,
    specialist: undefined,
    specialistName: '',
    status: 'self_serve',
    downPayment: 0,
    financeTerm: 60,
    budget: p.monthlyBudget,
    needsSpace: p.needsSpace,
    driving: 'same',
    focusedOption: '',
    chosenOption: '',
    version: 1,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
  });
  recompute(ctx, r);
  log(ctx, r.id, 'system', `${p.firstName} opened Next Move for their ${p.vehicleYear} ${p.vehicleModel}`);
});

export const requestSpecialist = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const r = getRoom(ctx, roomId);
  if (r.status === 'live') return;
  touch(ctx, r, { status: 'waiting' }, false);
  const p = getProfile(ctx, r.profileId);
  log(ctx, r.id, 'customer', `${p.firstName} asked to talk to a specialist`);
});

export const joinRoom = spacetimedb.reducer({ roomId: t.u64(), name: t.string() }, (ctx, { roomId, name }) => {
  const r = getRoom(ctx, roomId);
  const clean = name.trim().slice(0, 40) || 'Specialist';
  touch(ctx, r, { specialist: ctx.sender, specialistName: clean, status: r.status === 'decided' ? 'decided' : 'live' }, false);
  log(ctx, r.id, 'specialist', `${clean} from Toyota Financial Services joined`);
});

export const updateInputs = spacetimedb.reducer(
  { roomId: t.u64(), downPayment: t.f64(), financeTerm: t.u32() },
  (ctx, { roomId, downPayment, financeTerm }) => {
    const r = getRoom(ctx, roomId);
    const dp = Math.max(0, Math.min(20000, Math.round(downPayment / 100) * 100));
    const term = [36, 48, 60, 72].includes(financeTerm) ? financeTerm : 60;
    if (dp === r.downPayment && term === r.financeTerm) return;
    const next = touch(ctx, r, { downPayment: dp, financeTerm: term }, true);
    recompute(ctx, next);
  }
);

// "Life changes, plan changes": budget, needing more room, and how much they'll drive.
// Either screen can change it; every option is recalculated and re-ranked in the same transaction.
export const updateSituation = spacetimedb.reducer(
  { roomId: t.u64(), budget: t.f64(), needsSpace: t.bool(), driving: t.string() },
  (ctx, { roomId, budget, needsSpace, driving }) => {
    const r = getRoom(ctx, roomId);
    const b = Math.max(200, Math.min(2000, Math.round(budget)));
    const d = Object.keys(DRIVING_FACTORS).includes(driving) ? driving : 'same';
    if (b === r.budget && needsSpace === r.needsSpace && d === r.driving) return;

    const actor = actorFor(ctx, r);
    const who = actor === 'customer' ? getProfile(ctx, r.profileId).firstName : r.specialistName || 'Specialist';
    if (needsSpace !== r.needsSpace) log(ctx, r.id, actor, `${who} updated the situation: ${needsSpace ? 'needs more room' : 'current size is fine'}`);
    if (d !== r.driving) log(ctx, r.id, actor, `${who} updated the situation: ${DRIVING_LABELS[d]}`);

    const next = touch(ctx, r, { budget: b, needsSpace, driving: d }, true);
    recompute(ctx, next);
  }
);

export const focusOption = spacetimedb.reducer({ roomId: t.u64(), key: t.string() }, (ctx, { roomId, key }) => {
  const r = getRoom(ctx, roomId);
  if (r.focusedOption === key) return;
  touch(ctx, r, { focusedOption: key }, false);
});

export const sendOffer = spacetimedb.reducer({ roomId: t.u64(), templateId: t.u32() }, (ctx, { roomId, templateId }) => {
  const r = getRoom(ctx, roomId);
  const tpl = ctx.db.offerTemplate.id.find(templateId);
  if (!tpl || tpl.profileId !== r.profileId) throw new SenderError('That offer is not available for this customer');
  const already = [...ctx.db.offer.roomId.filter(roomId)].some(o => o.templateId === templateId && o.status !== 'declined');
  if (already) return;
  ctx.db.offer.insert({
    id: 0n,
    roomId,
    templateId,
    title: tpl.title,
    detail: tpl.detail,
    kind: tpl.kind,
    amount: tpl.amount,
    appliesTo: tpl.appliesTo,
    forModel: tpl.forModel,
    maxTerm: tpl.maxTerm,
    status: 'pending',
    sentBy: r.specialistName || 'Specialist',
    createdAt: ctx.timestamp,
  });
  log(ctx, roomId, 'specialist', `${r.specialistName || 'Specialist'} sent an offer: ${tpl.title}`);
});

export const respondOffer = spacetimedb.reducer({ offerId: t.u64(), accept: t.bool() }, (ctx, { offerId, accept }) => {
  const o = ctx.db.offer.id.find(offerId);
  if (!o) throw new SenderError('Offer not found');
  if (o.status !== 'pending') return;
  ctx.db.offer.id.update({ ...o, status: accept ? 'accepted' : 'declined' });
  const r = getRoom(ctx, o.roomId);
  const p = getProfile(ctx, r.profileId);
  log(ctx, r.id, 'customer', `${p.firstName} ${accept ? 'accepted' : 'declined'}: ${o.title}`);
  if (accept) {
    const next = touch(ctx, r, {}, true);
    recompute(ctx, next);
  }
});

export const chooseOption = spacetimedb.reducer({ roomId: t.u64(), key: t.string() }, (ctx, { roomId, key }) => {
  const r = getRoom(ctx, roomId);
  const q = [...ctx.db.quote.roomId.filter(roomId)].find(x => x.key === key);
  if (!q) throw new SenderError('Unknown option');
  touch(ctx, r, { chosenOption: key, focusedOption: key, status: 'decided' }, false);
  const who = actorFor(ctx, r) === 'customer' ? getProfile(ctx, r.profileId).firstName : r.specialistName;
  log(ctx, r.id, actorFor(ctx, r), `${who} chose: ${q.title} (${money(q.monthly)}/mo)`);
});

export const reopenRoom = spacetimedb.reducer({ roomId: t.u64() }, (ctx, { roomId }) => {
  const r = getRoom(ctx, roomId);
  touch(ctx, r, { chosenOption: '', status: r.specialist ? 'live' : 'self_serve' }, false);
});

// Wipes every session so the demo starts clean. Customers and offers stay.
export const resetDemo = spacetimedb.reducer(ctx => {
  for (const x of [...ctx.db.quote.iter()]) ctx.db.quote.id.delete(x.id);
  for (const x of [...ctx.db.offer.iter()]) ctx.db.offer.id.delete(x.id);
  for (const x of [...ctx.db.activity.iter()]) ctx.db.activity.id.delete(x.id);
  for (const x of [...ctx.db.explanation.iter()]) ctx.db.explanation.roomId.delete(x.roomId);
  for (const x of [...ctx.db.room.iter()]) ctx.db.room.id.delete(x.id);
});

// ---------------------------------------------------------------------------
// AI explanation
// ---------------------------------------------------------------------------

// The first identity to call this becomes the admin; only the admin can change it later.
export const setLlmConfig = spacetimedb.reducer(
  { endpoint: t.string(), apiKey: t.string(), model: t.string() },
  (ctx, { endpoint, apiKey, model }) => {
    const existing = ctx.db.llmConfig.id.find(1);
    if (existing && !existing.admin.isEqual(ctx.sender)) throw new SenderError('Only the admin can change the AI settings');
    const row = { id: 1, admin: ctx.sender, endpoint: endpoint.trim(), apiKey: apiKey.trim(), model: model.trim() };
    if (existing) ctx.db.llmConfig.id.update(row);
    else ctx.db.llmConfig.insert(row);
  }
);

const SYSTEM_PROMPT = [
  'You are the Next Move guide for Toyota Financial Services customers.',
  'Explain the customer\'s options in plain, friendly English a non-expert can follow.',
  'Rules:',
  '- Use ONLY the numbers in the data you are given. Never invent, estimate, or recalculate numbers.',
  '- The options are already ranked by the system. Recommend the rank 1 option and say why in terms of the customer\'s life and budget.',
  '- Mention one honest trade-off or risk.',
  '- End with one clear next step.',
  '- 110 words max. No markdown headings, no bullet lists, no em dashes.',
].join('\n');

export const explainRoom = spacetimedb.procedure({ roomId: t.u64() }, t.unit(), (ctx, { roomId }) => {
  // 1) Read everything we need and mark the explanation as "thinking" so both screens see it.
  const setup = ctx.withTx(tx => {
    const r = getRoom(tx, roomId);
    const p = livingProfile(tx, r);
    const quotes = [...tx.db.quote.roomId.filter(roomId)].sort((a, b) => a.rank - b.rank);
    const offers = [...tx.db.offer.roomId.filter(roomId)].filter(o => o.status === 'accepted').map(o => o.title);
    const config = tx.db.llmConfig.id.find(1);
    const exp = tx.db.explanation.roomId.find(roomId);
    if (exp) tx.db.explanation.roomId.update({ ...exp, status: 'thinking', error: '', updatedAt: tx.timestamp });
    const s = situation(p, drivingFactor(r.driving));
    const data = {
      customer: {
        name: p.firstName,
        lifeEvent: p.lifeEvent,
        drivingFromNowOn: DRIVING_LABELS[r.driving] ?? DRIVING_LABELS.same,
        needsMoreSpace: p.needsSpace,
        monthlyBudget: p.monthlyBudget,
        vehicle: `${p.vehicleYear} ${p.vehicleModel} ${p.vehicleTrim}`,
        contract: p.contractType,
        currentPayment: p.monthlyPayment,
        monthsLeft: s.monthsLeft,
        equityToday: Math.round(s.equityToday),
        milesOverProjected: s.milesOver,
        milesUnderProjected: s.milesUnder,
      },
      inputs: { downPayment: r.downPayment, financeTermMonths: r.financeTerm },
      acceptedOffers: offers,
      comparisonWindowMonths: HORIZON_MONTHS,
      rankedOptions: quotes.map(q => ({
        rank: q.rank,
        option: q.title,
        monthly: Math.round(q.monthly),
        monthlyAfterLeaseEnds: q.monthlyLater ? Math.round(q.monthlyLater) : undefined,
        dueNow: Math.round(q.dueNow),
        netCostOver3Years: Math.round(q.net36),
        fitsBudget: q.fitsBudget,
        fitsLifeNeeds: q.fitsLife,
        pros: q.pros,
        cons: q.cons,
        nextStep: q.nextStepLabel,
      })),
    };
    return { version: r.version, config: config ?? null, data: JSON.stringify(data) };
  });

  // 2) Network call happens outside any transaction.
  let result: { ok: true; text: string; model: string } | { ok: false; error: string };
  if (!setup.config || !setup.config.apiKey) {
    result = { ok: false, error: 'No AI key set, showing the rule-based explanation' };
  } else {
    result = callChat(ctx.http, setup.config.endpoint, setup.config.apiKey, setup.config.model, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Customer data (JSON):\n${setup.data}\n\nWrite the explanation now.` },
    ]);
  }

  // 3) Save the result so both screens update at the same time.
  ctx.withTx(tx => {
    const exp = tx.db.explanation.roomId.find(roomId);
    if (!exp) return;
    if (result.ok) {
      tx.db.explanation.roomId.update({
        ...exp,
        aiText: result.text.replace(/—/g, ', '),
        aiModel: result.model,
        aiVersion: setup.version,
        status: 'ready',
        error: '',
        updatedAt: tx.timestamp,
      });
    } else {
      tx.db.explanation.roomId.update({ ...exp, status: 'error', error: result.error, updatedAt: tx.timestamp });
    }
  });
  return {};
});
