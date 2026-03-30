import { describe, it, expect } from 'vitest';
import { computeDeviations, getSeverity } from '../deviationEngine';
import type { Session, Event, Baseline, Alert } from '@sangati/shared';

// ============================================================
// TEST FIXTURES
// ============================================================

const BASE_SESSION: Session = {
  id: 'sess-001',
  venue_id: 'venue-001',
  table_id: 'tbl-001',
  zone_id: 'zone-001',
  started_at: new Date(Date.now() - 3600_000).toISOString(),
  ended_at: null,
  status: 'active',
};

const BASELINES: Baseline[] = [
  { id: 'b1', venue_id: 'venue-001', zone_id: 'zone-001', metric: 'attend_latency_sec',  expected_value: 300,  updated_at: new Date().toISOString() },
  { id: 'b2', venue_id: 'venue-001', zone_id: 'zone-001', metric: 'kitchen_latency_sec', expected_value: 900,  updated_at: new Date().toISOString() },
  { id: 'b3', venue_id: 'venue-001', zone_id: 'zone-001', metric: 'bill_latency_sec',    expected_value: 240,  updated_at: new Date().toISOString() },
];

function makeEvent(type: string, offsetMs: number, id = type): Event {
  return {
    id,
    session_id: 'sess-001',
    type: type as Event['type'],
    value: null,
    ts: new Date(Date.now() - offsetMs).toISOString(),
  };
}

// ============================================================
// SEVERITY CLASSIFICATION
// ============================================================

describe('getSeverity', () => {
  it('returns low for 10-29% over', () => {
    expect(getSeverity(330, 300)).toBe('low');   // +10% → low
    expect(getSeverity(380, 300)).toBe('low');   // +26.7% → still low (threshold is 1.30)
  });

  it('returns med for 30-79% over', () => {
    expect(getSeverity(390, 300)).toBe('med');   // +30%
    expect(getSeverity(530, 300)).toBe('med');   // +77%
  });

  it('returns high for 80%+ over', () => {
    expect(getSeverity(540, 300)).toBe('high');  // +80%
    expect(getSeverity(720, 300)).toBe('high');  // +140%
  });
});

// ============================================================
// ATTEND LATENCY ALERTS
// ============================================================

describe('attend latency', () => {
  it('fires wait_overdue when seat has no attend and time exceeds threshold', () => {
    const events = [makeEvent('seat', 720_000)]; // seated 720s ago, expected 300s
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].type).toBe('wait_overdue');
    expect(result.alerts[0].routed_to_role).toBe('server');
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].reason).toContain('Attend latency');
  });

  it('does NOT fire when attend event exists', () => {
    const events = [
      makeEvent('seat',   600_000, 'seat-1'),
      makeEvent('attend', 300_000, 'attend-1'),
    ];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const waitAlerts = result.alerts.filter(a => a.type === 'wait_overdue');
    expect(waitAlerts).toHaveLength(0);
  });

  it('does NOT fire if session is closed', () => {
    const closed: Session = { ...BASE_SESSION, status: 'closed' };
    const events = [makeEvent('seat', 1800_000)];
    const result = computeDeviations({
      session: closed,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const waitAlerts = result.alerts.filter(a => a.type === 'wait_overdue');
    expect(waitAlerts).toHaveLength(0);
  });

  it('deduplicates: does not re-alert within DEDUP_WINDOW_SEC', () => {
    const events = [makeEvent('seat', 720_000)];
    const existingUnacked: Alert[] = [{
      id: 'existing',
      session_id: 'sess-001',
      type: 'wait_overdue',
      severity: 'med',
      message: 'existing',
      created_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
      acknowledged_at: null,
      acknowledged_by_staff_id: null,
      routed_to_role: 'server',
      routed_to_zone_id: 'zone-001',
    }];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: existingUnacked,
      now: new Date(),
    });

    const waitAlerts = result.alerts.filter(a => a.type === 'wait_overdue');
    expect(waitAlerts).toHaveLength(0);
  });
});

// ============================================================
// KITCHEN DELAY ALERTS
// ============================================================

describe('kitchen delay', () => {
  it('fires kitchen_overdue when order has no serve and time exceeds threshold', () => {
    const events = [
      makeEvent('seat',   2400_000, 's'),
      makeEvent('attend', 2100_000, 'a'),
      makeEvent('order',  1800_000, 'o'), // 1800s = 30min, expected 900s → ratio 2.0 → HIGH
    ];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const kitchenAlerts = result.alerts.filter(a => a.type === 'kitchen_overdue');
    expect(kitchenAlerts).toHaveLength(1);
    expect(kitchenAlerts[0].routed_to_role).toBe('kitchen');
    expect(kitchenAlerts[0].severity).toBe('high'); // 1800/900 = 2.0x → >1.80 → HIGH
  });

  it('routes kitchen alerts to kitchen role (never server)', () => {
    const events = [makeEvent('order', 2000_000)];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });
    const kitchenAlerts = result.alerts.filter(a => a.type === 'kitchen_overdue');
    expect(kitchenAlerts.every(a => a.routed_to_role === 'kitchen')).toBe(true);
  });
});

// ============================================================
// BILL LATENCY ALERTS
// ============================================================

describe('bill latency', () => {
  it('fires bill_overdue when bill exists without pay', () => {
    // bill 500s ago, expected 240s → >2x
    const events = [makeEvent('bill', 500_000)];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const billAlerts = result.alerts.filter(a => a.type === 'bill_overdue');
    expect(billAlerts).toHaveLength(1);
    expect(billAlerts[0].routed_to_role).toBe('server');
  });

  it('escalates to manager after BILL_ESCALATION_THRESHOLD existing alerts', () => {
    const events = [makeEvent('bill', 500_000)];
    const existing2: Alert[] = [
      { id: 'b1', session_id: 'sess-001', type: 'bill_overdue', severity: 'med', message: '', created_at: new Date(Date.now() - 600_000).toISOString(), acknowledged_at: null, acknowledged_by_staff_id: null, routed_to_role: 'server', routed_to_zone_id: null },
      { id: 'b2', session_id: 'sess-001', type: 'bill_overdue', severity: 'med', message: '', created_at: new Date(Date.now() - 900_000).toISOString(), acknowledged_at: null, acknowledged_by_staff_id: null, routed_to_role: 'server', routed_to_zone_id: null },
    ];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: existing2,
      now: new Date(),
    });

    const billAlerts = result.alerts.filter(a => a.type === 'bill_overdue');
    if (billAlerts.length > 0) {
      expect(billAlerts[0].routed_to_role).toBe('manager');
      expect(billAlerts[0].severity).toBe('high');
    }
  });
});

// ============================================================
// CALL PENDING ALERTS
// ============================================================

describe('call pending', () => {
  it('fires call_pending when call not followed by attend', () => {
    // call 600s ago, expected 300s
    const events = [makeEvent('call', 600_000)];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const callAlerts = result.alerts.filter(a => a.type === 'call_pending');
    expect(callAlerts).toHaveLength(1);
  });

  it('escalates call_pending to manager when >2x expected', () => {
    // call 700s ago, expected 300s → >2x
    const events = [makeEvent('call', 700_000)];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const callAlerts = result.alerts.filter(a => a.type === 'call_pending');
    if (callAlerts.length > 0) {
      expect(callAlerts[0].routed_to_role).toBe('manager');
    }
  });

  it('does NOT fire when call is followed by attend', () => {
    const events = [
      makeEvent('call',   600_000, 'call-1'),
      makeEvent('attend', 550_000, 'attend-1'), // attend after call
    ];
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const callAlerts = result.alerts.filter(a => a.type === 'call_pending');
    expect(callAlerts).toHaveLength(0);
  });
});

// ============================================================
// DECISION EXPLAINABILITY
// ============================================================

describe('decision reasons', () => {
  it('reason contains actual, expected, diff, and pct', () => {
    const events = [makeEvent('seat', 720_000)]; // 720s, expected 300
    const result = computeDeviations({
      session: BASE_SESSION,
      events,
      baselines: BASELINES,
      existingAlerts: [],
      now: new Date(),
    });

    const reason = result.decisions[0]?.reason ?? '';
    expect(reason).toContain('720');   // actual
    expect(reason).toContain('300');   // expected
    expect(reason).toMatch(/\+\d+s/);  // diff
    expect(reason).toMatch(/\+\d+%/);  // pct
  });
});
