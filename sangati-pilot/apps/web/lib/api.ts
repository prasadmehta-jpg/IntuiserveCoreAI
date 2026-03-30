import type {
  Alert, AlertWithContext, Session, Baseline, KPIs,
  Staff, Shift, ZoneAssignment, ZoneHealth,
} from '@sangati/shared';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3847';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Sessions ────────────────────────────────────────────────
export function fetchActiveSessions(venueId?: string): Promise<(Session & {
  zone_name: string;
  active_alerts: number;
  highest_severity: 'low' | 'med' | 'high' | null;
  last_event_type: string | null;
  last_event_ts: string | null;
  event_count: number;
})[]> {
  const qs = venueId ? `?venue_id=${venueId}` : '';
  return get(`/api/sessions/active${qs}`);
}

export function fetchSessionDetail(id: string): Promise<{
  session: Session;
  events: unknown[];
  features: unknown;
  alerts: Alert[];
  decisions: unknown[];
}> {
  return get(`/api/sessions/${id}`);
}

export function closeSession(id: string): Promise<{ ok: boolean }> {
  return post(`/api/sessions/${id}/close`, {});
}

// ── Alerts ──────────────────────────────────────────────────
export function fetchActiveAlerts(role?: string, zoneId?: string): Promise<AlertWithContext[]> {
  const params = new URLSearchParams();
  if (role)   params.set('role', role);
  if (zoneId) params.set('zone_id', zoneId);
  const qs = params.toString() ? `?${params}` : '';
  return get(`/api/alerts/active${qs}`);
}

export function fetchAllAlerts(venueId?: string): Promise<Alert[]> {
  const qs = venueId ? `?venue_id=${venueId}` : '';
  return get(`/api/alerts/all${qs}`);
}

export function ackAlert(id: string, staffId: string): Promise<{ ok: boolean; alert: Alert }> {
  return post(`/api/alerts/${id}/ack`, { staff_id: staffId });
}

// ── KPIs ────────────────────────────────────────────────────
export function fetchKPIs(venueId?: string): Promise<KPIs> {
  const qs = venueId ? `?venue_id=${venueId}` : '';
  return get(`/api/kpis${qs}`);
}

// ── Baselines ────────────────────────────────────────────────
export function fetchBaselines(venueId?: string, zoneId?: string): Promise<Baseline[]> {
  const params = new URLSearchParams();
  if (venueId) params.set('venue_id', venueId);
  if (zoneId)  params.set('zone_id', zoneId);
  const qs = params.toString() ? `?${params}` : '';
  return get(`/api/baselines${qs}`);
}

// ── Setup ────────────────────────────────────────────────────
export function fetchStaff(venueId?: string): Promise<Staff[]> {
  const qs = venueId ? `?venue_id=${venueId}` : '';
  return get(`/api/setup/staff${qs}`);
}

export function createStaff(data: Omit<Staff, 'id' | 'active'>): Promise<Staff> {
  return post('/api/setup/staff', data);
}

export function createShift(data: Omit<Shift, 'id'>): Promise<Shift> {
  return post('/api/setup/shifts', data);
}

export function createZoneAssignment(data: Omit<ZoneAssignment, 'id'>): Promise<ZoneAssignment> {
  return post('/api/setup/zone-assignments', data);
}

// ── Simulator (direct event ingest) ─────────────────────────
export function ingestEvent(body: {
  session_id: string;
  venue_id?: string;
  table_id?: string;
  zone_id?: string;
  type: string;
  value?: number;
  ts?: string;
}): Promise<{ ok: boolean; new_alerts?: number }> {
  return post('/api/events', body);
}

// ── Zone Health (derived client-side) ───────────────────────
export function deriveZoneHealth(
  sessions: { zone_id: string; zone_name: string; active_alerts: number; highest_severity: string | null }[],
  zoneNames: Record<string, string>
): ZoneHealth[] {
  const map: Record<string, ZoneHealth> = {};

  for (const s of sessions) {
    if (!map[s.zone_id]) {
      map[s.zone_id] = {
        zone_id:       s.zone_id,
        zone_name:     zoneNames[s.zone_id] ?? s.zone_name ?? s.zone_id,
        status:        'green',
        active_sessions: 0,
        active_alerts:   0,
        staff_on_zone:   [],
      };
    }
    map[s.zone_id].active_sessions++;
    map[s.zone_id].active_alerts += s.active_alerts;
  }

  // Derive status from alert density
  for (const zh of Object.values(map)) {
    if (zh.active_alerts === 0) zh.status = 'green';
    else if (zh.active_alerts <= 2) zh.status = 'yellow';
    else zh.status = 'red';
  }

  return Object.values(map);
}
