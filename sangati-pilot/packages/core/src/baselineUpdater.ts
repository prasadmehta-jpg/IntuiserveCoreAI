/**
 * SANGATI Baseline Updater
 * After a session closes, recomputes rolling average for venue+zone.
 * Returns updated Baseline[] so the caller can broadcast baseline.updated.
 */

import { v4 as uuid } from 'uuid';
import { sessionRepo, eventRepo, baselineRepo } from '@sangati/db';
import type { Baseline, BaselineMetric } from '@sangati/shared';
import { BASELINE_WINDOW, BASELINE_MIN_SAMPLES, DEFAULT_BASELINES } from '@sangati/shared';

function computeAttendLatency(events: { type: string; ts: string }[]): number | null {
  const sorted = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const seat   = sorted.find(e => e.type === 'seat');
  const attend = sorted.find(e => e.type === 'attend');
  if (!seat || !attend) return null;
  return (new Date(attend.ts).getTime() - new Date(seat.ts).getTime()) / 1000;
}

function computeKitchenLatency(events: { type: string; ts: string }[]): number | null {
  const sorted = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const order = sorted.find(e => e.type === 'order');
  const serve = sorted.find(e => e.type === 'serve');
  if (!order || !serve) return null;
  return (new Date(serve.ts).getTime() - new Date(order.ts).getTime()) / 1000;
}

function computeBillLatency(events: { type: string; ts: string }[]): number | null {
  const sorted = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const bill = sorted.find(e => e.type === 'bill');
  const pay  = sorted.find(e => e.type === 'pay');
  if (!bill || !pay) return null;
  return (new Date(pay.ts).getTime() - new Date(bill.ts).getTime()) / 1000;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Called after a session is closed.
 * Returns the list of baselines that were updated (empty if not enough data yet).
 */
export function updateBaselinesForSession(sessionId: string): Baseline[] {
  const session = sessionRepo.findById(sessionId);
  if (!session) return [];

  const { venue_id, zone_id } = session;
  const recentSessions = sessionRepo.findRecentClosed(venue_id, zone_id, BASELINE_WINDOW);
  if (recentSessions.length < BASELINE_MIN_SAMPLES) return [];

  const samples: Record<BaselineMetric, number[]> = {
    attend_latency_sec:  [],
    kitchen_latency_sec: [],
    bill_latency_sec:    [],
  };

  for (const s of recentSessions) {
    const events  = eventRepo.findBySession(s.id);
    const attend  = computeAttendLatency(events);
    const kitchen = computeKitchenLatency(events);
    const bill    = computeBillLatency(events);
    if (attend  !== null && attend  > 0) samples.attend_latency_sec.push(attend);
    if (kitchen !== null && kitchen > 0) samples.kitchen_latency_sec.push(kitchen);
    if (bill    !== null && bill    > 0) samples.bill_latency_sec.push(bill);
  }

  const now = new Date().toISOString();
  const updated: Baseline[] = [];

  for (const [metric, values] of Object.entries(samples) as [BaselineMetric, number[]][]) {
    if (values.length < BASELINE_MIN_SAMPLES) continue;
    const avg     = average(values);
    const min     = DEFAULT_BASELINES[metric] * 0.2;
    const max     = DEFAULT_BASELINES[metric] * 5.0;
    const clamped = Math.min(Math.max(avg, min), max);

    const baseline: Baseline = {
      id:             uuid(),
      venue_id,
      zone_id,
      metric,
      expected_value: Math.round(clamped),
      updated_at:     now,
    };
    baselineRepo.upsert(baseline);
    updated.push(baseline);
  }

  return updated;
}
