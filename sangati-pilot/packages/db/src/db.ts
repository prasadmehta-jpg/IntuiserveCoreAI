/**
 * SANGATI DB Layer — uses Node.js 22 built-in node:sqlite
 * Zero native compilation required. Synchronous API, pilot-ready.
 */

// Suppress the experimental warning for clean logs
const _originalEmit = process.emit.bind(process);
// @ts-ignore
process.emit = function(event: string, ...args: unknown[]) {
  if (event === 'warning' && args[0] &&
      typeof (args[0] as any).message === 'string' &&
      (args[0] as any).message.includes('SQLite')) return false;
  return _originalEmit(event, ...args);
};

import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

// Load node:sqlite at runtime so Vite/vitest's static analyser never sees the
// bare specifier "sqlite" (which it doesn't recognise as a Node built-in).
const _req = createRequire(import.meta.url);
const { DatabaseSync: _DatabaseSync } =
  _req('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSync };
import type {
  Session, Event, SessionFeatures, Decision, Alert,
  Staff, Shift, ZoneAssignment, Baseline, Venue, Table, Zone,
} from '@sangati/shared';

// ── Singleton ────────────────────────────────────────────────
let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const dbPath = path.resolve(process.env.DATABASE_PATH ?? './data/sangati.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new _DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');
  return _db;
}

export function closeDb(): void { if (_db) { _db.close(); _db = null; } }

// ── Generic helpers ──────────────────────────────────────────
export interface RunResult { changes: number; lastInsertRowid: number | bigint; }

export function dbRun(sql: string, params: unknown[] = []): RunResult {
  return getDb().prepare(sql).run(...params) as RunResult;
}
export function dbGet<T>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}
export function dbAll<T>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}
export function dbTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

// ── Venues ───────────────────────────────────────────────────
export const venueRepo = {
  upsert: (v: Venue) => dbRun('INSERT OR REPLACE INTO venues (id, name) VALUES (?,?)', [v.id, v.name]),
  findAll: (): Venue[] => dbAll<Venue>('SELECT * FROM venues'),
};

// ── Zones ────────────────────────────────────────────────────
export const zoneRepo = {
  upsert: (z: Zone) => dbRun('INSERT OR REPLACE INTO zones (id,venue_id,name) VALUES (?,?,?)', [z.id, z.venue_id, z.name]),
  findByVenue: (venueId: string): Zone[] => dbAll<Zone>('SELECT * FROM zones WHERE venue_id=?', [venueId]),
  findById: (id: string): Zone | undefined => dbGet<Zone>('SELECT * FROM zones WHERE id=?', [id]),
};

// ── Tables ───────────────────────────────────────────────────
export const tableRepo = {
  upsert: (t: Table) => dbRun('INSERT OR REPLACE INTO tables (id,venue_id,zone_id,label) VALUES (?,?,?,?)', [t.id, t.venue_id, t.zone_id, t.label]),
  findByVenue: (venueId: string): Table[] => dbAll<Table>('SELECT * FROM tables WHERE venue_id=?', [venueId]),
};

// ── Sessions ─────────────────────────────────────────────────
export const sessionRepo = {
  insert(s: Session) {
    dbRun(`INSERT INTO sessions (id,venue_id,table_id,zone_id,started_at,ended_at,status) VALUES (?,?,?,?,?,?,?)`,
      [s.id, s.venue_id, s.table_id, s.zone_id, s.started_at, s.ended_at ?? null, s.status]);
  },
  findById: (id: string): Session | undefined => dbGet<Session>('SELECT * FROM sessions WHERE id=?', [id]),
  findActive: (): Session[] => dbAll<Session>(`SELECT * FROM sessions WHERE status='active' ORDER BY started_at`),
  findActiveByVenue: (venueId: string): Session[] => dbAll<Session>(
    `SELECT * FROM sessions WHERE status='active' AND venue_id=? ORDER BY started_at`, [venueId]),
  close: (id: string, endedAt: string) => dbRun(`UPDATE sessions SET status='closed',ended_at=? WHERE id=?`, [endedAt, id]),
  findClosedToday(venueId: string): Session[] {
    const today = new Date().toISOString().slice(0, 10);
    return dbAll<Session>(`SELECT * FROM sessions WHERE venue_id=? AND status='closed' AND DATE(ended_at)=?`, [venueId, today]);
  },
  findRecentClosed: (venueId: string, zoneId: string, limit = 30): Session[] => dbAll<Session>(
    `SELECT * FROM sessions WHERE venue_id=? AND zone_id=? AND status='closed' ORDER BY ended_at DESC LIMIT ?`,
    [venueId, zoneId, limit]),
};

// ── Events ───────────────────────────────────────────────────
export const eventRepo = {
  insert: (e: Event) => dbRun(`INSERT INTO events (id,session_id,type,value,ts) VALUES (?,?,?,?,?)`,
    [e.id, e.session_id, e.type, e.value ?? null, e.ts]),
  findBySession: (sessionId: string): Event[] => dbAll<Event>(
    `SELECT * FROM events WHERE session_id=? ORDER BY ts ASC`, [sessionId]),
};

// ── Session Features ─────────────────────────────────────────
export const featureRepo = {
  upsert(f: SessionFeatures) {
    dbRun(`INSERT INTO session_features (session_id,wait_time_sec,staff_response_latency_sec,kitchen_delay_sec,alert_count,updated_at)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(session_id) DO UPDATE SET
             wait_time_sec=excluded.wait_time_sec,
             staff_response_latency_sec=excluded.staff_response_latency_sec,
             kitchen_delay_sec=excluded.kitchen_delay_sec,
             alert_count=excluded.alert_count,
             updated_at=excluded.updated_at`,
      [f.session_id, f.wait_time_sec, f.staff_response_latency_sec, f.kitchen_delay_sec, f.alert_count, f.updated_at]);
  },
  findBySession: (sessionId: string): SessionFeatures | undefined =>
    dbGet<SessionFeatures>('SELECT * FROM session_features WHERE session_id=?', [sessionId]),
};

// ── Decisions ────────────────────────────────────────────────
export const decisionRepo = {
  insert: (d: Decision) => dbRun(`INSERT INTO decisions (id,session_id,kind,reason,created_at) VALUES (?,?,?,?,?)`,
    [d.id, d.session_id, d.kind, d.reason, d.created_at]),
  findBySession: (sessionId: string): Decision[] => dbAll<Decision>(
    `SELECT * FROM decisions WHERE session_id=? ORDER BY created_at DESC`, [sessionId]),
};

// ── Alerts ───────────────────────────────────────────────────
export const alertRepo = {
  insert(a: Alert) {
    dbRun(`INSERT INTO alerts (id,session_id,severity,type,message,created_at,acknowledged_at,acknowledged_by_staff_id,routed_to_role,routed_to_zone_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [a.id, a.session_id, a.severity, a.type, a.message, a.created_at,
       a.acknowledged_at ?? null, a.acknowledged_by_staff_id ?? null,
       a.routed_to_role, a.routed_to_zone_id ?? null]);
  },
  acknowledge: (id: string, staffId: string, at: string) =>
    dbRun(`UPDATE alerts SET acknowledged_at=?,acknowledged_by_staff_id=? WHERE id=?`, [at, staffId, id]),
  findById: (id: string): Alert | undefined => dbGet<Alert>('SELECT * FROM alerts WHERE id=?', [id]),
  findActive: (): Alert[] => dbAll<Alert>(`SELECT * FROM alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC`),
  findActiveByRoleAndZone(role?: string, zoneId?: string): Alert[] {
    let sql = `SELECT * FROM alerts WHERE acknowledged_at IS NULL`;
    const p: unknown[] = [];
    if (role)   { sql += ` AND routed_to_role=?`;    p.push(role);   }
    if (zoneId) { sql += ` AND routed_to_zone_id=?`; p.push(zoneId); }
    return dbAll<Alert>(sql + ` ORDER BY created_at DESC`, p);
  },
  findBySession: (sessionId: string): Alert[] => dbAll<Alert>(
    `SELECT * FROM alerts WHERE session_id=? ORDER BY created_at DESC`, [sessionId]),
  findToday(venueId?: string): Alert[] {
    const today = new Date().toISOString().slice(0, 10);
    if (venueId) {
      return dbAll<Alert>(`SELECT a.* FROM alerts a JOIN sessions s ON s.id=a.session_id
        WHERE s.venue_id=? AND DATE(a.created_at)=? ORDER BY a.created_at DESC`, [venueId, today]);
    }
    return dbAll<Alert>(`SELECT * FROM alerts WHERE DATE(created_at)=? ORDER BY created_at DESC`, [today]);
  },
};

// ── Staff ────────────────────────────────────────────────────
export const staffRepo = {
  insert: (s: Staff) => dbRun(`INSERT INTO staff (id,venue_id,name,role,active) VALUES (?,?,?,?,?)`,
    [s.id, s.venue_id, s.name, s.role, s.active]),
  upsert: (s: Staff) => dbRun(`INSERT OR REPLACE INTO staff (id,venue_id,name,role,active) VALUES (?,?,?,?,?)`,
    [s.id, s.venue_id, s.name, s.role, s.active]),
  findByVenue: (venueId: string): Staff[] => dbAll<Staff>('SELECT * FROM staff WHERE venue_id=? AND active=1', [venueId]),
  findAll: (): Staff[] => dbAll<Staff>('SELECT * FROM staff WHERE active=1'),
  findById: (id: string): Staff | undefined => dbGet<Staff>('SELECT * FROM staff WHERE id=?', [id]),
};

// ── Shifts ───────────────────────────────────────────────────
export const shiftRepo = {
  insert: (s: Shift) => dbRun(`INSERT OR IGNORE INTO shifts (id,venue_id,staff_id,starts_at,ends_at) VALUES (?,?,?,?,?)`,
    [s.id, s.venue_id, s.staff_id, s.starts_at, s.ends_at]),
  findActiveByVenue: (venueId: string, now: string): Shift[] => dbAll<Shift>(
    `SELECT * FROM shifts WHERE venue_id=? AND starts_at<=? AND ends_at>=?`, [venueId, now, now]),
};

// ── Zone Assignments ─────────────────────────────────────────
export const zoneAssignmentRepo = {
  insert: (za: ZoneAssignment) => dbRun(
    `INSERT OR IGNORE INTO zone_assignments (id,venue_id,zone_id,staff_id,shift_id) VALUES (?,?,?,?,?)`,
    [za.id, za.venue_id, za.zone_id, za.staff_id, za.shift_id]),
  findStaffForZone: (zoneId: string, now: string): Staff[] => dbAll<Staff>(
    `SELECT s.* FROM staff s
     JOIN zone_assignments za ON za.staff_id=s.id
     JOIN shifts sh ON sh.id=za.shift_id
     WHERE za.zone_id=? AND sh.starts_at<=? AND sh.ends_at>=? AND s.active=1`,
    [zoneId, now, now]),
  findByVenue: (venueId: string): ZoneAssignment[] => dbAll<ZoneAssignment>(
    'SELECT * FROM zone_assignments WHERE venue_id=?', [venueId]),
};

// ── Baselines ────────────────────────────────────────────────
export const baselineRepo = {
  upsert(b: Baseline) {
    dbRun(`INSERT INTO baselines (id,venue_id,zone_id,metric,expected_value,updated_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(venue_id,zone_id,metric) DO UPDATE SET
             expected_value=excluded.expected_value, updated_at=excluded.updated_at`,
      [b.id, b.venue_id, b.zone_id, b.metric, b.expected_value, b.updated_at]);
  },
  findByVenueZone: (venueId: string, zoneId: string): Baseline[] => dbAll<Baseline>(
    `SELECT * FROM baselines WHERE venue_id=? AND zone_id=?`, [venueId, zoneId]),
  findAll: (): Baseline[] => dbAll<Baseline>('SELECT * FROM baselines'),
  findOne: (venueId: string, zoneId: string, metric: string): Baseline | undefined => dbGet<Baseline>(
    `SELECT * FROM baselines WHERE venue_id=? AND zone_id=? AND metric=?`, [venueId, zoneId, metric]),
};
