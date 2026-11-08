import { useEffect, useRef, useState } from 'react';
import type { Timestamp } from 'spacetimedb';
import type { Profile, Quote, Room } from './module_bindings/types';

export type {
  Activity,
  Explanation,
  Moment,
  Offer,
  OfferTemplate,
  Profile,
  Quote,
  Room,
} from './module_bindings/types';

export const TERMS = [36, 48, 60, 72];

// Cards keep a stable position so they don't jump around while you drag a slider.
const OPTION_ORDER = ['return', 'keep', 'buyout', 'refinance', 'pay_extra', 'upgrade_lease', 'upgrade_buy'];
export function byStableOrder(a: Quote, b: Quote) {
  return OPTION_ORDER.indexOf(a.key) - OPTION_ORDER.indexOf(b.key);
}

export function money(n: number, cents = false): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents ? 2 : 0,
    minimumFractionDigits: cents ? 2 : 0,
  });
}

export function toDate(ts: Timestamp): Date {
  return new Date(Number(ts.microsSinceUnixEpoch / 1000n));
}

export function timeAgo(ts: Timestamp, now: number): string {
  const s = Math.max(0, Math.round((now - toDate(ts).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function clockTime(ts: Timestamp): string {
  return toDate(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function vehicleName(p: Profile): string {
  return `${p.vehicleYear} ${p.vehicleModel} ${p.vehicleTrim}`;
}

// Mirrors DRIVING_FACTORS in spacetimedb/src/finance.ts.
export const DRIVING_OPTIONS = [
  { key: 'less', label: 'Less', factor: 0.5 },
  { key: 'same', label: 'Same', factor: 1 },
  { key: 'more', label: 'More', factor: 1.5 },
];
export function drivingFactorOf(driving: string): number {
  return DRIVING_OPTIONS.find(o => o.key === driving)?.factor ?? 1;
}

// The profile as it stands in this session, after the customer's life changes (mirrors applySituation on the server).
export function withSituation(p: Profile, room: Room): Profile {
  const next = { ...p, monthlyBudget: room.budget, needsSpace: room.needsSpace };
  if (room.needsSpace && !p.upgradeAddsSpace && p.roomyModel) {
    next.upgradeModel = p.roomyModel;
    next.upgradePrice = p.roomyPrice;
    next.upgradeAddsSpace = true;
  }
  return next;
}

export function situationOf(p: Profile, driving = 'same') {
  const factor = drivingFactorOf(driving);
  const monthsLeft = Math.max(0, p.termMonths - p.monthsElapsed);
  const equity = p.marketValue - p.balance;
  let milesOver = 0;
  let milesUnder = 0;
  if (p.contractType === 'lease' && p.monthsElapsed > 0) {
    const perMonth = p.currentMiles / p.monthsElapsed;
    const projected = Math.round(p.currentMiles + perMonth * monthsLeft * factor);
    const allowed = Math.round((p.milesPerYear * p.termMonths) / 12);
    milesOver = Math.max(0, projected - allowed);
    milesUnder = Math.max(0, allowed - projected);
  }
  return { monthsLeft, equity, milesOver, milesUnder };
}

// Smoothly tweens a number so live updates feel alive instead of snapping.
export function useAnimatedNumber(target: number, ms = 450): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    if (raf.current) cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = begin + (target - begin) * eased;
      from.current = v;
      setValue(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, ms]);
  return value;
}

// Re-render every few seconds for "x seconds ago" labels.
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function goTo(hash: string) {
  // Full reload so each role gets its own connection and identity.
  window.location.hash = hash;
  window.location.reload();
}
