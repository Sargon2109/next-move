// Pure, deterministic finance math for Next Move.
// Every number the customer sees comes from here. The AI never makes up numbers;
// it only explains what this file calculates.

export const HORIZON_MONTHS = 36; // we compare every option over the same 3 years
const SALES_TAX = 0.0625; // Texas motor vehicle sales tax
const DOC_FEE = 150;
const DISPOSITION_FEE = 350;
const PURCHASE_OPTION_FEE = 300;
const LEASE_ACQ_FEE = 650;
const LEASE_MONEY_FACTOR = 0.0021; // roughly 5.0% APR
const LEASE_RESIDUAL_36 = 0.6;
const USED_DEPRECIATION_PER_YEAR = 0.12;
const NEW_VALUE_RETAINED_36 = 0.62;
const REPLACEMENT_DUE_AT_SIGNING = 1500;
const EXTRA_PAYMENT = 100;
const NEW_LEASE_MILES_PER_YEAR = 12000;
const NEW_LEASE_OVERAGE_RATE = 0.25;

// How much the customer expects to drive from now on, relative to their pace so far.
export const DRIVING_FACTORS: Record<string, number> = { less: 0.5, same: 1, more: 1.5 };
export function drivingFactor(driving: string): number {
  return DRIVING_FACTORS[driving] ?? 1;
}

export type Profile = {
  id: number;
  firstName: string;
  contractType: string; // 'lease' | 'loan'
  vehicleYear: number;
  vehicleModel: string;
  vehicleTrim: string;
  monthlyPayment: number;
  termMonths: number;
  monthsElapsed: number;
  apr: number;
  balance: number; // loan balance today, or lease payoff today
  residual: number; // lease buyout price at lease end (0 for loans)
  marketValue: number;
  currentMiles: number;
  milesPerYear: number;
  overageRate: number;
  monthlyBudget: number;
  needsSpace: boolean;
  upgradeModel: string;
  upgradePrice: number;
  upgradeAddsSpace: boolean;
  roomyModel: string; // what we suggest instead when the customer needs more room
  roomyPrice: number;
  newApr: number;
  usedApr: number;
  replacementLease: number;
};

export type AcceptedOffer = {
  kind: string; // 'loyalty_cash' | 'apr' | 'waive_disposition' | 'prepay_miles'
  amount: number;
  appliesTo: string; // option key, or 'upgrade' for both upgrade options
  maxTerm: number; // 0 = no limit
  forModel: string; // '' = any model; otherwise only when this is the upgrade model
};

export type Inputs = {
  downPayment: number;
  financeTerm: number;
  drivingFactor: number;
};

// What the customer says changed in their life. Overrides the profile defaults.
export type LifeSituation = {
  budget: number;
  needsSpace: boolean;
};

export function applySituation<P extends Profile>(p: P, life: LifeSituation): P {
  const next = { ...p, monthlyBudget: life.budget, needsSpace: life.needsSpace };
  // If their usual upgrade has no extra room, suggest the roomier model instead.
  if (life.needsSpace && !p.upgradeAddsSpace && p.roomyModel) {
    next.upgradeModel = p.roomyModel;
    next.upgradePrice = p.roomyPrice;
    next.upgradeAddsSpace = true;
  }
  return next;
}

export type Quote = {
  key: string;
  title: string;
  subtitle: string;
  monthly: number;
  monthlyLater: number; // 0 unless the payment changes later (e.g. after a lease ends)
  dueNow: number;
  cashOut36: number;
  equity36: number;
  net36: number;
  fitsBudget: boolean;
  fitsLife: boolean;
  pros: string[];
  cons: string[];
  assumptions: string[];
  nextStep: string; // 'self_service' | 'follow_up' | 'offer'
  nextStepLabel: string;
  appliedOffers: string[];
  // Net cost so far for months 0..36: cash paid minus what the car is worth to you (value minus loan).
  // path[36] equals net36, so the chart always ends where the card's number is.
  path: number[];
};

export type RankedQuote = Quote & {
  rank: number;
  recommended: boolean;
  confidence: string;
};

// ---------- small helpers ----------

export function payment(principal: number, aprPct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function balanceAfter(principal: number, aprPct: number, pmt: number, paymentsMade: number): number {
  if (principal <= 0) return 0;
  const r = aprPct / 100 / 12;
  if (r === 0) return Math.max(0, principal - pmt * paymentsMade);
  const g = Math.pow(1 + r, paymentsMade);
  return Math.max(0, principal * g - (pmt * (g - 1)) / r);
}

function monthsToPayOff(principal: number, aprPct: number, pmt: number): number {
  const r = aprPct / 100 / 12;
  if (principal <= 0) return 0;
  if (r === 0) return Math.ceil(principal / pmt);
  if (pmt <= principal * r) return 9999;
  return Math.ceil(-Math.log(1 - (principal * r) / pmt) / Math.log(1 + r));
}

function usedValueAfter(value: number, months: number): number {
  return value * Math.pow(1 - USED_DEPRECIATION_PER_YEAR, months / 12);
}

// Smooth depreciation that lands on NEW_VALUE_RETAINED_36 at month 36.
function newValueAfter(price: number, months: number): number {
  return price * Math.pow(NEW_VALUE_RETAINED_36, months / HORIZON_MONTHS);
}

// One value per month, 0..HORIZON_MONTHS.
function byMonth(fn: (month: number) => number): number[] {
  const out: number[] = [];
  for (let m = 0; m <= HORIZON_MONTHS; m++) out.push(round2(fn(m)));
  return out;
}

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function offersFor(offers: AcceptedOffer[], key: string, term: number): AcceptedOffer[] {
  return offers.filter(o => {
    const matches = o.appliesTo === key || (o.appliesTo === 'upgrade' && key.startsWith('upgrade'));
    const termOk = o.maxTerm === 0 || term <= o.maxTerm;
    return matches && termOk;
  });
}

function loyaltyCash(offers: AcceptedOffer[]): number {
  return offers.filter(o => o.kind === 'loyalty_cash').reduce((s, o) => s + o.amount, 0);
}

function aprOverride(offers: AcceptedOffer[], fallback: number): number {
  const o = offers.find(x => x.kind === 'apr');
  return o ? Math.min(o.amount, fallback) : fallback;
}

// ---------- situation summary (shared by quotes, moments and the AI prompt) ----------

export type Situation = {
  monthsLeft: number;
  equityToday: number;
  projectedMiles: number;
  allowedMiles: number;
  milesOver: number;
  milesUnder: number;
  overageFee: number;
  milesPerYearPace: number; // expected driving from now on
};

export function situation(p: Profile, driving = 1): Situation {
  const monthsLeft = Math.max(0, p.termMonths - p.monthsElapsed);
  const equityToday = p.marketValue - p.balance;
  const milesPerMonth = p.monthsElapsed > 0 ? p.currentMiles / p.monthsElapsed : 0;
  const milesPerYearPace = Math.round(milesPerMonth * 12 * driving);
  if (p.contractType !== 'lease') {
    return { monthsLeft, equityToday, projectedMiles: 0, allowedMiles: 0, milesOver: 0, milesUnder: 0, overageFee: 0, milesPerYearPace };
  }
  // Miles driven so far, plus the remaining months at the expected pace.
  const projectedMiles = Math.round(p.currentMiles + milesPerMonth * monthsLeft * driving);
  const allowedMiles = Math.round((p.milesPerYear * p.termMonths) / 12);
  const milesOver = Math.max(0, projectedMiles - allowedMiles);
  const milesUnder = Math.max(0, allowedMiles - projectedMiles);
  return {
    monthsLeft,
    equityToday,
    projectedMiles,
    allowedMiles,
    milesOver,
    milesUnder,
    overageFee: milesOver * p.overageRate,
    milesPerYearPace,
  };
}

// ---------- option builders ----------

function finish(p: Profile, q: Omit<Quote, 'fitsBudget' | 'net36'>): Quote {
  return {
    ...q,
    monthly: round2(q.monthly),
    monthlyLater: round2(q.monthlyLater),
    dueNow: round2(q.dueNow),
    cashOut36: round2(q.cashOut36),
    equity36: round2(q.equity36),
    net36: round2(q.cashOut36 - q.equity36),
    fitsBudget: Math.max(q.monthly, q.monthlyLater) <= p.monthlyBudget + 0.5,
  };
}

function returnAtEnd(p: Profile, s: Situation, offers: AcceptedOffer[]): Quote {
  const mine = offersFor(offers, 'return', 0);
  const prepay = mine.find(o => o.kind === 'prepay_miles');
  const waived = mine.some(o => o.kind === 'waive_disposition');
  const mileageCost = s.milesOver * (prepay ? prepay.amount : p.overageRate);
  const disposition = waived ? 0 : DISPOSITION_FEE;
  const laterMonths = Math.max(0, HORIZON_MONTHS - s.monthsLeft);
  const turnIn = mileageCost + disposition + REPLACEMENT_DUE_AT_SIGNING; // all due when the lease ends
  const cashOut = p.monthlyPayment * s.monthsLeft + turnIn + p.replacementLease * laterMonths;
  const equityAtEnd = usedValueAfter(p.marketValue, s.monthsLeft) - p.residual;

  const cons: string[] = [];
  if (equityAtEnd > 500) cons.push(`Walks away from about ${money(equityAtEnd)} of equity at lease end`);
  if (s.milesOver > 0) {
    cons.push(
      prepay
        ? `${s.milesOver.toLocaleString('en-US')} miles over, prepaid now at $${prepay.amount.toFixed(2)}/mi (${money(mileageCost)})`
        : `Trending ${s.milesOver.toLocaleString('en-US')} miles over: about ${money(mileageCost)} at turn-in`
    );
  }
  if (p.needsSpace) cons.push('A comparable vehicle will not add the room you need');
  if (cons.length === 0) cons.push('You will need to shop for your next car soon');

  const applied: string[] = [];
  if (prepay) applied.push('Prepaid miles');
  if (waived) applied.push('Disposition fee waived');

  return finish(p, {
    key: 'return',
    title: 'Return it at lease end',
    subtitle: `Then lease a comparable new ${p.vehicleModel}`,
    monthly: p.monthlyPayment,
    monthlyLater: p.replacementLease,
    dueNow: 0,
    cashOut36: cashOut,
    equity36: 0,
    fitsLife: !p.needsSpace,
    pros: ['Nothing to decide today', `Payment stays ${money(p.monthlyPayment)}/mo for ${s.monthsLeft} more months`],
    cons,
    assumptions: [
      `Next lease about ${money(p.replacementLease)}/mo with ${money(REPLACEMENT_DUE_AT_SIGNING)} due at signing`,
      `Disposition fee ${waived ? 'waived' : money(DISPOSITION_FEE)}`,
      s.milesOver > 0
        ? `Mileage projected from your ${p.currentMiles.toLocaleString('en-US')} miles so far`
        : 'No mileage overage projected',
    ],
    nextStep: 'self_service',
    nextStepLabel: 'Schedule your lease-end inspection online',
    appliedOffers: applied,
    path: byMonth(
      m => p.monthlyPayment * Math.min(m, s.monthsLeft) + (m >= s.monthsLeft ? turnIn : 0) + p.replacementLease * Math.max(0, m - s.monthsLeft)
    ),
  });
}

function buyOutNow(p: Profile, s: Situation, offers: AcceptedOffer[], inputs: Inputs): Quote {
  const mine = offersFor(offers, 'buyout', inputs.financeTerm);
  const apr = aprOverride(mine, p.usedApr);
  const price = p.balance + PURCHASE_OPTION_FEE;
  const financed = Math.max(0, price * (1 + SALES_TAX) + DOC_FEE - inputs.downPayment);
  const pmt = payment(financed, apr, inputs.financeTerm);
  const paid = Math.min(HORIZON_MONTHS, inputs.financeTerm);
  const bal36 = balanceAfter(financed, apr, pmt, paid);
  const value36 = usedValueAfter(p.marketValue, HORIZON_MONTHS);
  const interest = pmt * inputs.financeTerm - financed;

  const pros = ['Keep the car you already know'];
  if (s.equityToday > 0) pros.push(`Keeps your ${money(s.equityToday)} of equity`);
  if (s.milesOver > 0) pros.push(`No mileage penalty (saves about ${money(s.overageFee)})`);
  if (s.milesUnder > 3000) pros.push(`Low miles: you are ${s.milesUnder.toLocaleString('en-US')} under your allowance`);

  const cons = [`About ${money(interest)} in interest over ${inputs.financeTerm} months`];
  if (p.needsSpace) cons.push('Same size vehicle, so no extra room');

  return finish(p, {
    key: 'buyout',
    title: `Buy your ${p.vehicleModel} now`,
    subtitle: `${p.vehicleYear} ${p.vehicleModel} ${p.vehicleTrim}, financed at ${apr.toFixed(2)}% for ${inputs.financeTerm} mo`,
    monthly: pmt,
    monthlyLater: 0,
    dueNow: inputs.downPayment,
    cashOut36: inputs.downPayment + pmt * paid,
    equity36: value36 - bal36,
    fitsLife: !p.needsSpace,
    pros,
    cons,
    assumptions: [
      `Payoff ${money(p.balance)} + ${money(PURCHASE_OPTION_FEE)} purchase fee + ${(SALES_TAX * 100).toFixed(2)}% sales tax`,
      `Car loses about ${(USED_DEPRECIATION_PER_YEAR * 100).toFixed(0)}% of its value per year`,
    ],
    nextStep: mine.length > 0 ? 'offer' : 'self_service',
    nextStepLabel: 'Get your payoff quote and apply for buyout financing',
    appliedOffers: mine.map(o => (o.kind === 'apr' ? `${o.amount}% APR offer` : o.kind)),
    path: byMonth(m => {
      const k = Math.min(m, inputs.financeTerm);
      return inputs.downPayment + pmt * k - (usedValueAfter(p.marketValue, m) - balanceAfter(financed, apr, pmt, k));
    }),
  });
}

function upgradeLease(p: Profile, s: Situation, offers: AcceptedOffer[], inputs: Inputs): Quote {
  const mine = offersFor(offers, 'upgrade_lease', 36);
  const loyalty = loyaltyCash(mine);
  const cap = p.upgradePrice + LEASE_ACQ_FEE - s.equityToday - inputs.downPayment - loyalty;
  const residual = p.upgradePrice * LEASE_RESIDUAL_36;
  const base = (cap - residual) / 36 + (cap + residual) * LEASE_MONEY_FACTOR;
  const monthly = Math.max(0, base * (1 + SALES_TAX));

  // At the customer's expected pace, how far past the new lease's mileage limit will they go?
  const milesOver = Math.max(0, Math.round((s.milesPerYearPace - NEW_LEASE_MILES_PER_YEAR) * 3));
  const mileageCost = milesOver * NEW_LEASE_OVERAGE_RATE;

  const pros = ['Lowest payment for a brand-new car', 'Full factory warranty'];
  if (s.equityToday > 0) pros.push(`Rolls your ${money(s.equityToday)} of equity into the new car`);
  if (p.needsSpace && p.upgradeAddsSpace) pros.unshift('Adds the room your family needs');
  if (loyalty > 0) pros.push(`${money(loyalty)} loyalty cash applied`);

  const cons =
    milesOver > 0
      ? [`At your pace you'd drive about ${milesOver.toLocaleString('en-US')} miles over: about ${money(mileageCost)} at turn-in`, 'You will not own it at the end']
      : ['You will not own it at the end', 'Mileage limits again'];

  return finish(p, {
    key: 'upgrade_lease',
    title: `Lease a new ${p.upgradeModel}`,
    subtitle: '36-month lease, 12,000 miles a year',
    monthly,
    monthlyLater: 0,
    dueNow: inputs.downPayment + monthly,
    cashOut36: inputs.downPayment + monthly * 36 + mileageCost,
    equity36: 0,
    fitsLife: !p.needsSpace || p.upgradeAddsSpace,
    pros,
    cons,
    assumptions: [
      `Price ${money(p.upgradePrice)}, ${(LEASE_RESIDUAL_36 * 100).toFixed(0)}% residual, money factor ${LEASE_MONEY_FACTOR}`,
      `Trade-in equity ${money(s.equityToday)} goes toward the new lease`,
      `You drive about ${s.milesPerYearPace.toLocaleString('en-US')} miles a year; miles over ${NEW_LEASE_MILES_PER_YEAR.toLocaleString('en-US')}/yr cost $${NEW_LEASE_OVERAGE_RATE.toFixed(2)} each`,
    ],
    nextStep: loyalty > 0 ? 'offer' : 'follow_up',
    nextStepLabel: 'A specialist confirms inventory and locks your price',
    appliedOffers: loyalty > 0 ? ['Loyalty cash'] : [],
    // First payment is due at signing; any mileage charge lands at turn-in (month 36).
    path: byMonth(m => inputs.downPayment + monthly * Math.min(m + 1, 36) + (m >= 36 ? mileageCost : 0)),
  });
}

function upgradeBuy(p: Profile, s: Situation, offers: AcceptedOffer[], inputs: Inputs): Quote {
  const mine = offersFor(offers, 'upgrade_buy', inputs.financeTerm);
  const loyalty = loyaltyCash(mine);
  const apr = aprOverride(mine, p.newApr);
  const financed = Math.max(0, p.upgradePrice * (1 + SALES_TAX) + DOC_FEE - s.equityToday - inputs.downPayment - loyalty);
  const pmt = payment(financed, apr, inputs.financeTerm);
  const paid = Math.min(HORIZON_MONTHS, inputs.financeTerm);
  const bal36 = balanceAfter(financed, apr, pmt, paid);
  const value36 = p.upgradePrice * NEW_VALUE_RETAINED_36;

  const pros = ['Brand-new car you own', 'Full factory warranty'];
  if (p.needsSpace && p.upgradeAddsSpace) pros.unshift('Adds the room your family needs');
  if (s.equityToday > 0) pros.push(`Uses your ${money(s.equityToday)} of equity as a down payment`);

  const applied: string[] = [];
  if (loyalty > 0) applied.push('Loyalty cash');
  if (apr < p.newApr) applied.push(`${apr}% APR offer`);

  return finish(p, {
    key: 'upgrade_buy',
    title: `Buy a new ${p.upgradeModel}`,
    subtitle: `Financed at ${apr.toFixed(2)}% for ${inputs.financeTerm} mo`,
    monthly: pmt,
    monthlyLater: 0,
    dueNow: inputs.downPayment,
    cashOut36: inputs.downPayment + pmt * paid,
    equity36: value36 - bal36,
    fitsLife: !p.needsSpace || p.upgradeAddsSpace,
    pros,
    cons: ['Highest monthly payment', 'New cars lose value fastest in the first 3 years'],
    assumptions: [
      `Price ${money(p.upgradePrice)} + tax and fees`,
      `New car keeps about ${(NEW_VALUE_RETAINED_36 * 100).toFixed(0)}% of its value after 3 years`,
    ],
    nextStep: applied.length > 0 ? 'offer' : 'follow_up',
    nextStepLabel: 'A specialist confirms inventory and locks your rate',
    appliedOffers: applied,
    path: byMonth(m => {
      const k = Math.min(m, inputs.financeTerm);
      return inputs.downPayment + pmt * k - (newValueAfter(p.upgradePrice, m) - balanceAfter(financed, apr, pmt, k));
    }),
  });
}

function keepLoan(p: Profile, s: Situation): Quote {
  const paid = Math.min(HORIZON_MONTHS, s.monthsLeft);
  const bal36 = balanceAfter(p.balance, p.apr, p.monthlyPayment, paid);
  const value36 = usedValueAfter(p.marketValue, HORIZON_MONTHS);
  return finish(p, {
    key: 'keep',
    title: 'Keep your loan as is',
    subtitle: `${s.monthsLeft} payments left at ${p.apr.toFixed(2)}% APR`,
    monthly: p.monthlyPayment,
    monthlyLater: 0,
    dueNow: 0,
    cashOut36: p.monthlyPayment * paid,
    equity36: value36 - bal36,
    fitsLife: !p.needsSpace,
    pros: ['No paperwork', 'Nothing changes'],
    cons: [
      ...(p.needsSpace ? ['Same car, so no extra room'] : []),
      `You are paying ${p.apr.toFixed(2)}% from before your credit improved`,
    ],
    assumptions: [`Balance today ${money(p.balance)}`],
    nextStep: 'self_service',
    nextStepLabel: 'Turn on autopay and keep going',
    appliedOffers: [],
    path: byMonth(m => {
      const k = Math.min(m, s.monthsLeft);
      return p.monthlyPayment * k - (usedValueAfter(p.marketValue, m) - balanceAfter(p.balance, p.apr, p.monthlyPayment, k));
    }),
  });
}

function refinance(p: Profile, s: Situation, offers: AcceptedOffer[], inputs: Inputs): Quote {
  const mine = offersFor(offers, 'refinance', inputs.financeTerm);
  const apr = aprOverride(mine, p.usedApr);
  const principal = Math.max(0, p.balance - inputs.downPayment);
  const pmt = payment(principal, apr, inputs.financeTerm);
  const paid = Math.min(HORIZON_MONTHS, inputs.financeTerm);
  const bal36 = balanceAfter(principal, apr, pmt, paid);
  const value36 = usedValueAfter(p.marketValue, HORIZON_MONTHS);
  const savings = p.monthlyPayment - pmt;
  const extraMonths = inputs.financeTerm - s.monthsLeft;

  const pros = [`New rate ${apr.toFixed(2)}% instead of ${p.apr.toFixed(2)}%`];
  if (savings > 0) pros.unshift(`Lowers your payment by ${money(savings)}/mo`);
  const cons: string[] = [];
  if (p.needsSpace) cons.push('Same car, so no extra room');
  if (extraMonths > 0) cons.push(`Adds ${extraMonths} months to your loan`);
  else cons.push('Requires a quick credit check');

  return finish(p, {
    key: 'refinance',
    title: 'Refinance with Toyota Financial',
    subtitle: `${apr.toFixed(2)}% for ${inputs.financeTerm} mo`,
    monthly: pmt,
    monthlyLater: 0,
    dueNow: inputs.downPayment,
    cashOut36: inputs.downPayment + pmt * paid,
    equity36: value36 - bal36,
    fitsLife: !p.needsSpace,
    pros,
    cons,
    assumptions: [`Refinancing your ${money(p.balance)} balance`, inputs.downPayment > 0 ? `${money(inputs.downPayment)} paid down first` : 'No cash paid down'],
    nextStep: mine.length > 0 ? 'offer' : 'self_service',
    nextStepLabel: 'Apply to refinance online in about 5 minutes',
    appliedOffers: mine.map(o => `${o.amount}% APR offer`),
    path: byMonth(m => {
      const k = Math.min(m, inputs.financeTerm);
      return inputs.downPayment + pmt * k - (usedValueAfter(p.marketValue, m) - balanceAfter(principal, apr, pmt, k));
    }),
  });
}

function payExtra(p: Profile, s: Situation): Quote {
  const pmt = p.monthlyPayment + EXTRA_PAYMENT;
  const months = monthsToPayOff(p.balance, p.apr, pmt);
  const paid = Math.min(HORIZON_MONTHS, months);
  const bal36 = balanceAfter(p.balance, p.apr, pmt, paid);
  const value36 = usedValueAfter(p.marketValue, HORIZON_MONTHS);
  const normalInterest = p.monthlyPayment * s.monthsLeft - p.balance;
  const extraInterest = pmt * months - p.balance;
  return finish(p, {
    key: 'pay_extra',
    title: `Pay ${money(EXTRA_PAYMENT)} extra each month`,
    subtitle: `Paid off ${Math.max(0, s.monthsLeft - months)} months early`,
    monthly: pmt,
    monthlyLater: 0,
    dueNow: 0,
    cashOut36: pmt * paid,
    equity36: value36 - bal36,
    fitsLife: !p.needsSpace,
    pros: [`Saves about ${money(normalInterest - extraInterest)} in interest`, 'Own your car sooner'],
    cons: [...(p.needsSpace ? ['Same car, so no extra room'] : []), 'Raises your monthly payment'],
    assumptions: [`Extra ${money(EXTRA_PAYMENT)} goes straight to principal`],
    nextStep: 'self_service',
    nextStepLabel: 'Set up an extra principal payment online',
    appliedOffers: [],
    path: byMonth(m => {
      const k = Math.min(m, months);
      return pmt * k - (usedValueAfter(p.marketValue, m) - balanceAfter(p.balance, p.apr, pmt, k));
    }),
  });
}

// ---------- main entry ----------

export function buildQuotes(p: Profile, inputs: Inputs, allOffers: AcceptedOffer[]): RankedQuote[] {
  const s = situation(p, inputs.drivingFactor);
  // Model-specific offers only count when that model is the one being suggested.
  const offers = allOffers.filter(o => !o.forModel || o.forModel === p.upgradeModel);
  const quotes: Quote[] =
    p.contractType === 'lease'
      ? [returnAtEnd(p, s, offers), buyOutNow(p, s, offers, inputs), upgradeLease(p, s, offers, inputs), upgradeBuy(p, s, offers, inputs)]
      : [keepLoan(p, s), refinance(p, s, offers, inputs), payExtra(p, s), upgradeBuy(p, s, offers, inputs)];

  // Honest, explainable ranking: life needs first, then budget, then lowest 3-year net cost.
  const sorted = [...quotes].sort((a, b) => {
    if (a.fitsLife !== b.fitsLife) return a.fitsLife ? -1 : 1;
    if (a.fitsBudget !== b.fitsBudget) return a.fitsBudget ? -1 : 1;
    return a.net36 - b.net36;
  });

  const best = sorted[0];
  const runnerUp = sorted[1];
  let confidence = 'Low';
  if (best.fitsLife && best.fitsBudget) {
    const sameTier = runnerUp && runnerUp.fitsLife === best.fitsLife && runnerUp.fitsBudget === best.fitsBudget;
    const gap = sameTier ? (runnerUp.net36 - best.net36) / Math.max(1, Math.abs(best.net36)) : 1;
    confidence = gap >= 0.05 ? 'High' : 'Medium';
  }

  return sorted.map((q, i) => ({
    ...q,
    rank: i + 1,
    recommended: i === 0,
    confidence: i === 0 ? confidence : '',
  }));
}

// Rule-based explanation, used when no AI key is set or the AI call fails.
export function rulesExplanation(p: Profile, ranked: RankedQuote[]): string {
  const best = ranked[0];
  const next = ranked[1];
  const lines: string[] = [];
  lines.push(`${p.firstName}, the best fit right now is to ${best.title.charAt(0).toLowerCase()}${best.title.slice(1)}.`);
  const why: string[] = [];
  if (p.needsSpace && best.fitsLife) why.push('it gives you the extra room you need');
  if (best.fitsBudget) why.push(`it keeps you at ${money(best.monthly)}/mo, inside your ${money(p.monthlyBudget)} budget`);
  else why.push(`it is the closest option to your ${money(p.monthlyBudget)} budget, but still ${money(best.monthly - p.monthlyBudget)}/mo over`);
  lines.push(`Why: ${why.join(' and ')}.`);
  if (next) {
    const diff = next.net36 - best.net36;
    if (diff > 0) lines.push(`Compared with "${next.title}", it costs about ${money(diff)} less over 3 years.`);
    else lines.push(`"${next.title}" costs ${money(-diff)} less over 3 years, but it does not fit your needs as well.`);
  }
  if (best.cons[0]) lines.push(`Keep in mind: ${best.cons[0].charAt(0).toLowerCase()}${best.cons[0].slice(1)}.`);
  lines.push(`Next step: ${best.nextStepLabel.charAt(0).toLowerCase()}${best.nextStepLabel.slice(1)}.`);
  return lines.join(' ');
}
