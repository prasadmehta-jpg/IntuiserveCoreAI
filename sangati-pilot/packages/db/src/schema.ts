export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- SUPPORT TABLES (minimal)
-- ============================================================

CREATE TABLE IF NOT EXISTS venues (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  id       TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  name     TEXT NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id)
);

CREATE TABLE IF NOT EXISTS tables (
  id       TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  zone_id  TEXT NOT NULL,
  label    TEXT NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id),
  FOREIGN KEY (zone_id)  REFERENCES zones(id)
);

-- ============================================================
-- L1 — CORE TABLES (Raw Reality)
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  venue_id   TEXT NOT NULL,
  table_id   TEXT NOT NULL,
  zone_id    TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at   DATETIME NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  CHECK (status IN ('active', 'closed')),
  FOREIGN KEY (venue_id) REFERENCES venues(id),
  FOREIGN KEY (table_id) REFERENCES tables(id),
  FOREIGN KEY (zone_id)  REFERENCES zones(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_status   ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_venue     ON sessions(venue_id);
CREATE INDEX IF NOT EXISTS idx_sessions_zone      ON sessions(zone_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started   ON sessions(started_at);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type       TEXT NOT NULL,
  value      REAL NULL,
  ts         DATETIME NOT NULL,
  CHECK (type IN ('seat','attend','order','serve','bill','pay','call','note')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type    ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);

-- ============================================================
-- L2 — RELATIONAL ENTITIES
-- ============================================================

CREATE TABLE IF NOT EXISTS session_features (
  session_id                  TEXT PRIMARY KEY,
  wait_time_sec               REAL NOT NULL DEFAULT 0,
  staff_response_latency_sec  REAL NOT NULL DEFAULT 0,
  kitchen_delay_sec           REAL NOT NULL DEFAULT 0,
  alert_count                 INTEGER NOT NULL DEFAULT 0,
  updated_at                  DATETIME NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS decisions (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  CHECK (kind IN ('nudge','escalation','info')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);

CREATE TABLE IF NOT EXISTS alerts (
  id                       TEXT PRIMARY KEY,
  session_id               TEXT NOT NULL,
  severity                 TEXT NOT NULL,
  type                     TEXT NOT NULL,
  message                  TEXT NOT NULL,
  created_at               DATETIME NOT NULL,
  acknowledged_at          DATETIME NULL,
  acknowledged_by_staff_id TEXT NULL,
  routed_to_role           TEXT NOT NULL,
  routed_to_zone_id        TEXT NULL,
  CHECK (severity IN ('low','med','high')),
  CHECK (type IN ('wait_overdue','bill_overdue','kitchen_overdue','call_pending')),
  CHECK (routed_to_role IN ('server','manager','kitchen','bar')),
  FOREIGN KEY (session_id)               REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (acknowledged_by_staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_session    ON alerts(session_id);
CREATE INDEX IF NOT EXISTS idx_alerts_acked      ON alerts(acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_alerts_role       ON alerts(routed_to_role);
CREATE INDEX IF NOT EXISTS idx_alerts_zone       ON alerts(routed_to_zone_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created    ON alerts(created_at);

CREATE TABLE IF NOT EXISTS staff (
  id       TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  name     TEXT NOT NULL,
  role     TEXT NOT NULL,
  active   INTEGER NOT NULL DEFAULT 1,
  CHECK (role IN ('server','manager','kitchen','bar')),
  FOREIGN KEY (venue_id) REFERENCES venues(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_venue ON staff(venue_id);
CREATE INDEX IF NOT EXISTS idx_staff_role  ON staff(role);

CREATE TABLE IF NOT EXISTS shifts (
  id         TEXT PRIMARY KEY,
  venue_id   TEXT NOT NULL,
  staff_id   TEXT NOT NULL,
  starts_at  DATETIME NOT NULL,
  ends_at    DATETIME NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_shifts_staff ON shifts(staff_id);
CREATE INDEX IF NOT EXISTS idx_shifts_time  ON shifts(starts_at, ends_at);

CREATE TABLE IF NOT EXISTS zone_assignments (
  id         TEXT PRIMARY KEY,
  venue_id   TEXT NOT NULL,
  zone_id    TEXT NOT NULL,
  staff_id   TEXT NOT NULL,
  shift_id   TEXT NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id),
  FOREIGN KEY (zone_id)  REFERENCES zones(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE INDEX IF NOT EXISTS idx_zone_assignments_zone  ON zone_assignments(zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_staff ON zone_assignments(staff_id);

-- ============================================================
-- L3 — DEVIATION INTELLIGENCE (Baselines)
-- ============================================================

CREATE TABLE IF NOT EXISTS baselines (
  id             TEXT PRIMARY KEY,
  venue_id       TEXT NOT NULL,
  zone_id        TEXT NOT NULL,
  metric         TEXT NOT NULL,
  expected_value REAL NOT NULL,
  updated_at     DATETIME NOT NULL,
  CHECK (metric IN ('attend_latency_sec','bill_latency_sec','kitchen_latency_sec')),
  UNIQUE (venue_id, zone_id, metric),
  FOREIGN KEY (venue_id) REFERENCES venues(id),
  FOREIGN KEY (zone_id)  REFERENCES zones(id)
);

CREATE INDEX IF NOT EXISTS idx_baselines_venue_zone ON baselines(venue_id, zone_id);

-- ============================================================
-- CAMERAS (full registry with NVR support)
-- NOTE: If upgrading from a previous schema, delete data/sangati.db
--       and restart — CREATE TABLE IF NOT EXISTS does not alter columns.
-- ============================================================

CREATE TABLE IF NOT EXISTS cameras (
  id               TEXT PRIMARY KEY,
  venue_id         TEXT NOT NULL,
  zone_id          TEXT,                           -- NULL until mapped in setup
  nvr_id           TEXT,                           -- NULL for standalone cameras
  ip               TEXT NOT NULL DEFAULT '',
  rtsp_main        TEXT NOT NULL DEFAULT '',
  rtsp_sub         TEXT NOT NULL DEFAULT '',       -- always use sub for AI
  manufacturer     TEXT,
  model            TEXT,
  label            TEXT NOT NULL,
  channel_index    INTEGER NOT NULL DEFAULT 1,     -- NVR channel (1-based)
  onvif_capable    INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'discovered',
  credentials_set  INTEGER NOT NULL DEFAULT 0,     -- 1 when user has set credentials
  active           INTEGER NOT NULL DEFAULT 1,
  added_at         DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at       DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (venue_id) REFERENCES venues(id)
);

CREATE INDEX IF NOT EXISTS idx_cameras_venue ON cameras(venue_id);
CREATE INDEX IF NOT EXISTS idx_cameras_zone  ON cameras(zone_id);

CREATE TABLE IF NOT EXISTS nvrs (
  id                TEXT PRIMARY KEY,
  venue_id          TEXT NOT NULL,
  ip                TEXT NOT NULL,
  manufacturer      TEXT NOT NULL,
  model             TEXT,
  channels          INTEGER NOT NULL DEFAULT 4,
  onvif_service_url TEXT,
  sadp_discovered   INTEGER NOT NULL DEFAULT 0,
  added_at          DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (venue_id) REFERENCES venues(id)
);

CREATE TABLE IF NOT EXISTS camera_stream_log (
  id         TEXT PRIMARY KEY,
  camera_id  TEXT NOT NULL REFERENCES cameras(id),
  event      TEXT NOT NULL,
  message    TEXT,
  ts         DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stream_log_cam ON camera_stream_log(camera_id, ts);

CREATE TABLE IF NOT EXISTS occupancy_readings (
  id           TEXT PRIMARY KEY,
  camera_id    TEXT NOT NULL REFERENCES cameras(id),
  zone_id      TEXT NOT NULL,
  table_id     TEXT NOT NULL,
  occupied     INTEGER NOT NULL,
  confidence   REAL NOT NULL,
  person_count INTEGER NOT NULL DEFAULT 0,
  ts           DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_occupancy_ts   ON occupancy_readings(ts);
CREATE INDEX IF NOT EXISTS idx_occupancy_zone ON occupancy_readings(zone_id);

CREATE TABLE IF NOT EXISTS vision_signals (
  id           TEXT PRIMARY KEY,
  camera_id    TEXT NOT NULL,
  venue_id     TEXT NOT NULL,
  zone_id      TEXT NOT NULL,
  table_id     TEXT,
  event_type   TEXT NOT NULL,
  confidence   REAL NOT NULL DEFAULT 1.0,
  session_id   TEXT,
  processed    INTEGER NOT NULL DEFAULT 0,
  ts           DATETIME NOT NULL,
  FOREIGN KEY (camera_id) REFERENCES cameras(id)
);

CREATE INDEX IF NOT EXISTS idx_vsig_camera    ON vision_signals(camera_id);
CREATE INDEX IF NOT EXISTS idx_vsig_processed ON vision_signals(processed);
CREATE INDEX IF NOT EXISTS idx_vsig_ts        ON vision_signals(ts);

-- ============================================================
-- VENUE CONFIG (key-value store for consent, settings)
-- ============================================================

CREATE TABLE IF NOT EXISTS venue_config (
  venue_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL DEFAULT '{}',
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (venue_id, key)
);

-- ============================================================
-- POS EVENTS (inbound webhook log)
-- ============================================================

CREATE TABLE IF NOT EXISTS pos_events (
  id             TEXT PRIMARY KEY,
  venue_id       TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'unknown',
  raw_type       TEXT NOT NULL,
  mapped_type    TEXT,
  table_id       TEXT,
  session_id     TEXT,
  payload        TEXT NOT NULL DEFAULT '{}',
  processed      INTEGER NOT NULL DEFAULT 0,
  ts             DATETIME NOT NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id)
);

CREATE INDEX IF NOT EXISTS idx_pos_venue     ON pos_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_pos_processed ON pos_events(processed);
`;
