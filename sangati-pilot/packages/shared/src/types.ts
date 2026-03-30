// ============================================================
// SANGATI SHARED TYPES — L1/L2/L3 Data Model
// ============================================================

export type SessionStatus = 'active' | 'closed';

export type EventType =
  | 'seat'    // Guest seated
  | 'attend'  // Staff acknowledged table
  | 'order'   // Order placed
  | 'serve'   // Food/drinks delivered
  | 'bill'    // Bill requested
  | 'pay'     // Payment done
  | 'call'    // Guest called for attention
  | 'note';   // Free-form note

export type AlertSeverity = 'low' | 'med' | 'high';

export type AlertType =
  | 'wait_overdue'
  | 'bill_overdue'
  | 'kitchen_overdue'
  | 'call_pending';

export type StaffRole = 'server' | 'manager' | 'kitchen' | 'bar';

export type DecisionKind = 'nudge' | 'escalation' | 'info';

export type BaselineMetric =
  | 'attend_latency_sec'
  | 'bill_latency_sec'
  | 'kitchen_latency_sec';

// ============================================================
// L1 — Core Tables (Raw Reality)
// ============================================================

export interface Session {
  id: string;
  venue_id: string;
  table_id: string;
  zone_id: string;
  started_at: string;
  ended_at: string | null;
  status: SessionStatus;
}

export interface Event {
  id: string;
  session_id: string;
  type: EventType;
  value: number | null;
  ts: string;
}

// ============================================================
// L2 — Relational Entities (Structure)
// ============================================================

export interface SessionFeatures {
  session_id: string;
  wait_time_sec: number;
  staff_response_latency_sec: number;
  kitchen_delay_sec: number;
  alert_count: number;
  updated_at: string;
}

export interface Decision {
  id: string;
  session_id: string;
  kind: DecisionKind;
  reason: string;
  created_at: string;
}

export interface Alert {
  id: string;
  session_id: string;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by_staff_id: string | null;
  routed_to_role: StaffRole;
  routed_to_zone_id: string | null;
}

export interface Staff {
  id: string;
  venue_id: string;
  name: string;
  role: StaffRole;
  active: number; // 1 | 0
}

export interface Shift {
  id: string;
  venue_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
}

export interface ZoneAssignment {
  id: string;
  venue_id: string;
  zone_id: string;
  staff_id: string;
  shift_id: string;
}

// ============================================================
// L3 — Deviation Intelligence (Baselines)
// ============================================================

export interface Baseline {
  id: string;
  venue_id: string;
  zone_id: string;
  metric: BaselineMetric;
  expected_value: number;
  updated_at: string;
}

// ============================================================
// Support Entities
// ============================================================

export interface Venue {
  id: string;
  name: string;
}

export interface Table {
  id: string;
  venue_id: string;
  zone_id: string;
  label: string; // e.g. "T1", "T2"
}

export interface Zone {
  id: string;
  venue_id: string;
  name: string;
}

// ============================================================
// WebSocket Messages
// ============================================================

export type WsMessageType =
  | 'alert.created'
  | 'alert.acknowledged'
  | 'session.updated'
  | 'baseline.updated'
  | 'occupancy.updated';

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
  ts: string;
}

// ============================================================
// API Request/Response Shapes
// ============================================================

export interface IngestEventBody {
  session_id: string;
  venue_id?: string;
  table_id?: string;
  zone_id?: string;
  type: EventType;
  value?: number;
  ts?: string; // ISO string; defaults to now
}

export interface AckAlertBody {
  staff_id: string;
}

export interface KPIs {
  avg_attend_latency_sec: number;
  avg_kitchen_delay_sec: number;
  alerts_per_hour: number;
  sessions_with_multiple_alerts_pct: number;
  avg_ack_latency_sec: number;
  active_sessions: number;
  total_alerts_today: number;
}

// Enriched alert used in UI (joins session + table info)
export interface AlertWithContext extends Alert {
  table_label?: string;
  zone_name?: string;
  session_started_at?: string;
}

// Zone health summary for manager view
export interface ZoneHealth {
  zone_id: string;
  zone_name: string;
  status: 'green' | 'yellow' | 'red';
  active_sessions: number;
  active_alerts: number;
  staff_on_zone: string[];
}
