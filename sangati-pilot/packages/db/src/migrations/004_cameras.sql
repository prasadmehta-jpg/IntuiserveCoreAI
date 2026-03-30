-- Migration 004: Camera registry, NVR support, stream logging, occupancy readings
-- All statements use IF NOT EXISTS / safe defaults — safe to re-run.

CREATE TABLE IF NOT EXISTS cameras (
  id               TEXT PRIMARY KEY,
  venue_id         TEXT NOT NULL,
  zone_id          TEXT,
  nvr_id           TEXT,
  ip               TEXT NOT NULL DEFAULT '',
  rtsp_main        TEXT NOT NULL DEFAULT '',
  rtsp_sub         TEXT NOT NULL DEFAULT '',
  manufacturer     TEXT,
  model            TEXT,
  label            TEXT NOT NULL,
  channel_index    INTEGER NOT NULL DEFAULT 1,
  onvif_capable    INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'discovered',
  credentials_set  INTEGER NOT NULL DEFAULT 0,
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
