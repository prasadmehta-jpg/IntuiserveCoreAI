/**
 * SANGATI Deviation Engine — L3 Intelligence
 *
 * Computes actual vs expected timings per session.
 * Classifies severity. Produces alerts + decision explanations.
 *
 * Pure function: takes snapshot of session state → returns what to create.
 * No DB writes here — caller commits results.
 */

import type {
  Session, Event, Alert, Baseline, Decision, SessionFeatures,
  AlertSeverity, AlertType, StaffRole, DecisionKind, BaselineMetric,
} from '@sangati/shared';
import {
  DEFAULT_BASELINES,
  ALERT_TRIGGER_RATIO,
  ALERT_TRIGGER_ABS_SEC,
  SEVERITY_THRESHOLDS,
  BILL_ESCALATION_THRESHOLD,
  CALL_ESCALATION_RATIO,
  MAX_ALERTS_PER_SESSION_PER_TYPE,
  DEDUP_WINDOW_SEC,
} from '@sangati/shared';

// ============================================================
// INPUT / OUTPUT TYPES
// ============================================================

export interface DeviationInput {
  session: Session;
  events: Event[];
  baselines: Baseline[];
  existingAlerts: Alert[];
  now: Date;
}

export interface AlertDraft {
  session_id: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  acknowledged_at: null;
  acknowledged_by_staff_id: null;
  routed_to_role: StaffRole;
  routed_to_zone_id: string | null;
}

export interface DecisionDraft {
  session_id: string;
  kind: DecisionKind;
  reason: string;
}

export interface FeatureDraft {
  session_id: string;
  wait_time_sec: number;
  staff_response_latency_sec: number;
  kitchen_delay_sec: number;
  alert_count: number;
}

export interface DeviationOutput {
  alerts: AlertDraft[];
  decisions: DecisionDraft[];
  features: FeatureDraft;
}

// ============================================================
// HELPERS
// ============================================================

function getExpected(
  baselines: Baseline[],
  metric: BaselineMetric,
  venueId: string,
  zoneId: string
): number {
  const match = baselines.find(
    b => b.metric === metric && b.venue_id === venueId && b.zone_id === zoneId
  );
  return match?.expected_value ?? DEFAULT_BASELINES[metric];
}

function shouldTrigger(actual: number, expected: number): boolean {
  return actual > expected * ALERT_TRIGGER_RATIO || (actual - expected) > ALERT_TRIGGER_ABS_SEC;
}

export function getSeverity(actual: number, expected: number): AlertSeverity {
  const ratio = actual / expected;
  if (ratio >= SEVERITY_THRESHOLDS.high) return 'high';
  if (ratio >= SEVERITY_THRESHOLDS.med)  return 'med';
  return 'low';
}

function formatReason(
  metric: string,
  actual: number,
  expected: number
): string {
  const diff = Math.round(actual - expected);
  const pct  = Math.round(((actual - expected) / expected) * 100);
  return `${metric} ${Math.round(actual)}s > expected ${expected}s (+${diff}s, +${pct}%).`;
}

/** Dedup: is there an unacknowledged alert of this type within dedup window? */
function isRecentUnacked(
  existingAlerts: Alert[],
  type: AlertType,
  dedupSec: number,
  now: Date
): boolean {
  const cutoff = new Date(now.getTime() - dedupSec * 1000);
  return existingAlerts.some(
    a => a.type === type &&
      !a.acknowledged_at &&
      new Date(a.created_at) > cutoff
  );
}

/** Cap: don't create more than N alerts of same type per session */
function isCapReached(existingAlerts: Alert[], type: AlertType): boolean {
  return existingAlerts.filter(a => a.type === type).length >= MAX_ALERTS_PER_SESSION_PER_TYPE;
}

// ============================================================
// MAIN DEVIATION COMPUTATION
// ============================================================

export function computeDeviations(input: DeviationInput): DeviationOutput {
  const { session, events, baselines, existingAlerts, now } = input;

  const alerts:    AlertDraft[]   = [];
  const decisions: DecisionDraft[] = [];

  // Sorted events, oldest first
  const sorted = [...events].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  const firstOf = (type: string) => sorted.find(e => e.type === type);
  const allOf   = (type: string) => sorted.filter(e => e.type === type);

  const seatEvent    = firstOf('seat');
  const attendEvent  = firstOf('attend');
  const orderEvent   = firstOf('order');
  const serveEvent   = firstOf('serve');
  const billEvent    = firstOf('bill');
  const payEvent     = firstOf('pay');
  const callEvents   = allOf('call');

  const nowMs = now.getTime();

  let wait_time_sec = 0;
  let staff_response_latency_sec = 0;
  let kitchen_delay_sec = 0;

  // ============================================================
  // 1. ATTEND LATENCY — seat → attend
  // ============================================================
  if (seatEvent) {
    const seatMs = new Date(seatEvent.ts).getTime();
    const actual = attendEvent
      ? (new Date(attendEvent.ts).getTime() - seatMs) / 1000
      : session.status === 'active'
        ? (nowMs - seatMs) / 1000
        : 0;

    wait_time_sec = actual;
    staff_response_latency_sec = actual;

    if (!attendEvent && session.status === 'active') {
      const expected = getExpected(baselines, 'attend_latency_sec', session.venue_id, session.zone_id);

      if (
        shouldTrigger(actual, expected) &&
        !isRecentUnacked(existingAlerts, 'wait_overdue', DEDUP_WINDOW_SEC, now) &&
        !isCapReached(existingAlerts, 'wait_overdue')
      ) {
        const sev = getSeverity(actual, expected);
        alerts.push({
          session_id: session.id,
          severity: sev,
          type: 'wait_overdue',
          message: `Table unattended ${Math.round(actual)}s (expected ${expected}s)`,
          acknowledged_at: null,
          acknowledged_by_staff_id: null,
          routed_to_role: 'server',
          routed_to_zone_id: session.zone_id,
        });
        decisions.push({
          session_id: session.id,
          kind: 'nudge',
          reason: formatReason('Attend latency', actual, expected),
        });
      }
    }
  }

  // ============================================================
  // 2. KITCHEN DELAY — order → serve
  // ============================================================
  if (orderEvent) {
    const orderMs = new Date(orderEvent.ts).getTime();
    const actual = serveEvent
      ? (new Date(serveEvent.ts).getTime() - orderMs) / 1000
      : session.status === 'active'
        ? (nowMs - orderMs) / 1000
        : 0;

    kitchen_delay_sec = actual;

    if (!serveEvent && session.status === 'active') {
      const expected = getExpected(baselines, 'kitchen_latency_sec', session.venue_id, session.zone_id);

      if (
        shouldTrigger(actual, expected) &&
        !isRecentUnacked(existingAlerts, 'kitchen_overdue', DEDUP_WINDOW_SEC, now) &&
        !isCapReached(existingAlerts, 'kitchen_overdue')
      ) {
        const sev = getSeverity(actual, expected);
        alerts.push({
          session_id: session.id,
          severity: sev,
          type: 'kitchen_overdue',
          message: `Kitchen delay ${Math.round(actual)}s (expected ${expected}s)`,
          acknowledged_at: null,
          acknowledged_by_staff_id: null,
          routed_to_role: 'kitchen',
          routed_to_zone_id: null,
        });
        decisions.push({
          session_id: session.id,
          kind: 'nudge',
          reason: formatReason('Kitchen delay', actual, expected),
        });
      }
    }
  }

  // ============================================================
  // 3. BILL LATENCY — bill → pay (with escalation)
  // ============================================================
  if (billEvent && !payEvent && session.status === 'active') {
    const billMs  = new Date(billEvent.ts).getTime();
    const actual  = (nowMs - billMs) / 1000;
    const expected = getExpected(baselines, 'bill_latency_sec', session.venue_id, session.zone_id);

    if (
      shouldTrigger(actual, expected) &&
      !isRecentUnacked(existingAlerts, 'bill_overdue', DEDUP_WINDOW_SEC, now) &&
      !isCapReached(existingAlerts, 'bill_overdue')
    ) {
      const existingBillCount = existingAlerts.filter(a => a.type === 'bill_overdue').length;
      const escalate   = existingBillCount >= BILL_ESCALATION_THRESHOLD;
      const sev:  AlertSeverity = escalate ? 'high' : getSeverity(actual, expected);
      const role: StaffRole     = escalate ? 'manager' : 'server';
      const kind: DecisionKind  = escalate ? 'escalation' : 'nudge';

      alerts.push({
        session_id: session.id,
        severity: sev,
        type: 'bill_overdue',
        message: `Bill pending ${Math.round(actual)}s${escalate ? ' [ESCALATED TO MANAGER]' : ''}`,
        acknowledged_at: null,
        acknowledged_by_staff_id: null,
        routed_to_role: role,
        routed_to_zone_id: session.zone_id,
      });
      decisions.push({
        session_id: session.id,
        kind,
        reason: formatReason('Bill latency', actual, expected) +
          (escalate ? ' Escalating to manager.' : ''),
      });
    }
  }

  // ============================================================
  // 4. CALL PENDING — call event not followed by attend
  // ============================================================
  for (const callEvent of callEvents) {
    const callMs   = new Date(callEvent.ts).getTime();
    const responded = sorted.some(
      e => e.type === 'attend' && new Date(e.ts).getTime() > callMs
    );

    if (!responded && session.status === 'active') {
      const actual   = (nowMs - callMs) / 1000;
      const expected = getExpected(baselines, 'attend_latency_sec', session.venue_id, session.zone_id);

      if (
        shouldTrigger(actual, expected) &&
        !isRecentUnacked(existingAlerts, 'call_pending', DEDUP_WINDOW_SEC, now) &&
        !isCapReached(existingAlerts, 'call_pending')
      ) {
        const escalate = actual > expected * CALL_ESCALATION_RATIO;
        const sev:  AlertSeverity = escalate ? 'high' : 'med';
        const role: StaffRole     = escalate ? 'manager' : 'server';
        const kind: DecisionKind  = escalate ? 'escalation' : 'nudge';
        const pct  = Math.round(((actual - expected) / expected) * 100);

        alerts.push({
          session_id: session.id,
          severity: sev,
          type: 'call_pending',
          message: `Guest call unanswered ${Math.round(actual)}s`,
          acknowledged_at: null,
          acknowledged_by_staff_id: null,
          routed_to_role: role,
          routed_to_zone_id: session.zone_id,
        });
        decisions.push({
          session_id: session.id,
          kind,
          reason: `Call pending ${Math.round(actual)}s > expected ${expected}s (+${Math.round(actual - expected)}s, +${pct}%).` +
            (escalate ? ' Escalating to manager.' : ''),
        });
      }
    }
  }

  const alert_count = existingAlerts.length + alerts.length;

  return {
    alerts,
    decisions,
    features: {
      session_id: session.id,
      wait_time_sec,
      staff_response_latency_sec,
      kitchen_delay_sec,
      alert_count,
    },
  };
}
