// ============================================================
// SANGATI DISPLAY LABELS — single source of truth
// All floor staff screens import from here.
// Backend values (DB column names, event type keys) stay unchanged.
// ============================================================

// ── Alert type keys → plain-English heading ──────────────────
export const ALERT_TYPE_LABEL: Record<string, string> = {
  wait_overdue:    'Table waiting too long',
  kitchen_overdue: 'Kitchen is running late',
  bill_overdue:    'Bill not yet collected',
  call_pending:    'Guest needs attention',
};

// ── Alert type keys → short badge text ───────────────────────
export const ALERT_TYPE_SHORT: Record<string, string> = {
  wait_overdue:    'Long wait',
  kitchen_overdue: 'Kitchen delay',
  bill_overdue:    'Bill pending',
  call_pending:    'Guest calling',
};

// ── Severity codes → action words ────────────────────────────
export const SEVERITY_LABEL: Record<string, string> = {
  low:  'Check soon',
  med:  'Attend now',
  high: 'Urgent',
};

// ── Severity → Tailwind border/background color classes ──────
export const SEVERITY_COLOR: Record<string, string> = {
  low:  'border-yellow-500/30 bg-yellow-500/5',
  med:  'border-orange-500/40 bg-orange-500/5',
  high: 'border-red-500/50 bg-red-500/8',
};

// ── Severity → dot indicator color ───────────────────────────
export const SEVERITY_DOT: Record<string, string> = {
  low:  '#D97706',  // amber
  med:  '#EA580C',  // orange
  high: '#DC2626',  // red
};

// ── Event type keys → past-tense label (staff sees after tap) ─
export const EVENT_TYPE_LABEL: Record<string, string> = {
  seat:   'Guests seated',
  attend: 'Table attended',
  order:  'Order taken',
  serve:  'Food served',
  bill:   'Bill requested',
  pay:    'Payment received',
  call:   'Guest calling',
  note:   'Note logged',
};

// ── Event type keys → action button label ────────────────────
export const EVENT_TYPE_ACTION: Record<string, string> = {
  seat:   'Seat guests',
  attend: 'Attend table',
  order:  'Take order',
  serve:  'Mark served',
  bill:   'Request bill',
  pay:    'Mark paid',
  call:   'Attend call',
  note:   'Add note',
};

// ── Session status → plain English ───────────────────────────
export const SESSION_STATUS_LABEL: Record<string, string> = {
  active: 'Table occupied',
  closed: 'Table cleared',
};

// ── Staff roles → display names ──────────────────────────────
export const ROLE_LABEL: Record<string, string> = {
  server:  'Server',
  manager: 'Manager',
  kitchen: 'Kitchen',
  bar:     'Bar',
};

// ── Routed-to role → "sent to …" text on alert card ─────────
export const ROUTED_TO_LABEL: Record<string, string> = {
  server:  'Sent to server',
  manager: 'Escalated to manager',
  kitchen: 'Sent to kitchen',
  bar:     'Sent to bar',
};

// ── Agent names (internal) → readable label ──────────────────
export const AGENT_LABEL: Record<string, string> = {
  FloorMonitorAgent: 'Floor Monitor',
  KOTAgent:          'Kitchen Tracker',
  BillAgent:         'Bill Tracker',
  CallAgent:         'Call Handler',
};

// ── Acknowledged badge text ───────────────────────────────────
export const ACK_LABEL = 'Done';

// ── Safe lookup helper ────────────────────────────────────────
// Returns the mapped label or the raw key as fallback so nothing
// breaks if a new enum value is added before labels are updated.
export function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
