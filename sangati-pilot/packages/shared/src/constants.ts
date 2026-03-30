import type { BaselineMetric, AlertSeverity } from './types';

// ============================================================
// DEFAULT BASELINES (used before venue data accumulates)
// ============================================================
export const DEFAULT_BASELINES: Record<BaselineMetric, number> = {
  attend_latency_sec: 300,    // 5 minutes
  kitchen_latency_sec: 900,   // 15 minutes
  bill_latency_sec: 240,      // 4 minutes
};

// ============================================================
// DEVIATION THRESHOLDS
// ============================================================

/** Minimum ratio of actual/expected before ANY alert fires */
export const DEVIATION_MIN_RATIO = 1.1;

/** Minimum absolute overshoot (seconds) before ANY alert fires */
export const DEVIATION_MIN_ABS_SEC = 180; // 3 minutes

/** Triggers: actual > expected * RATIO OR actual - expected > ABS */
export const ALERT_TRIGGER_RATIO = 1.5;
export const ALERT_TRIGGER_ABS_SEC = 180;

// Severity thresholds (ratio of actual/expected)
export const SEVERITY_THRESHOLDS: Record<AlertSeverity, number> = {
  low: 1.10,   // >10% over
  med: 1.30,   // >30% over
  high: 1.80,  // >80% over
};

// Bill alert escalation threshold: number of existing bill alerts before escalating to manager
export const BILL_ESCALATION_THRESHOLD = 2;

// Call pending: ratio to escalate to manager
export const CALL_ESCALATION_RATIO = 2.0;

// ============================================================
// BASELINE LEARNING
// ============================================================

/** Number of historical sessions used in rolling average */
export const BASELINE_WINDOW = 30;

/** Minimum sessions needed before baseline overrides default */
export const BASELINE_MIN_SAMPLES = 5;

// ============================================================
// TICKER INTERVAL
// ============================================================
export const TICK_INTERVAL_MS = 15_000; // check all active sessions every 15 seconds

// ============================================================
// ALERT CAPS
// ============================================================
export const MAX_ALERTS_PER_SESSION_PER_TYPE = 3; // stop spamming same type
export const DEDUP_WINDOW_SEC = 300; // 5 min: don't re-alert same type within window

// ============================================================
// UI LABELS
// ============================================================
export const ALERT_TYPE_LABELS: Record<string, string> = {
  wait_overdue: 'Table Unattended',
  bill_overdue: 'Bill Pending',
  kitchen_overdue: 'Kitchen Delay',
  call_pending: 'Guest Calling',
};

export const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  low: '#D97706',    // amber
  med: '#EA580C',    // orange
  high: '#DC2626',   // red
};

export const ROLE_LABELS: Record<string, string> = {
  server: 'Server',
  manager: 'Manager',
  kitchen: 'Kitchen',
  bar: 'Bar',
};

// ============================================================
// SEED / DEMO DATA
// ============================================================
export const DEMO_VENUE_ID = 'venue-demo-001';
export const DEMO_ZONE_IDS = ['zone-floor-a', 'zone-floor-b', 'zone-terrace'];
export const DEMO_TABLE_COUNT = 12;
