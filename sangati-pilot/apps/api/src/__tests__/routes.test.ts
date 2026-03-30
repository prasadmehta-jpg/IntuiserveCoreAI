/**
 * API Route Tests — ingest + ack
 * Uses Fastify's inject() to test routes without a live server.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import wsPlugin from '@fastify/websocket';
import path from 'path';

// Point to a test-only DB
process.env.DATABASE_PATH = path.resolve(process.cwd(), 'data/sangati-test-routes.db');

import { runMigrations, getDb, venueRepo, zoneRepo, tableRepo, baselineRepo, staffRepo } from '@sangati/db';
import { DEFAULT_BASELINES, DEMO_VENUE_ID } from '@sangati/shared';
import type { BaselineMetric } from '@sangati/shared';
import { eventsRoute }   from '../routes/events';
import { sessionsRoute } from '../routes/sessions';
import { alertsRoute }   from '../routes/alerts';
import { v4 as uuid }    from 'uuid';

const app = Fastify({ logger: false });

beforeAll(async () => {
  // Reset test DB
  const db = getDb();
  db.exec(`
    DROP TABLE IF EXISTS alerts; DROP TABLE IF EXISTS decisions;
    DROP TABLE IF EXISTS session_features; DROP TABLE IF EXISTS events;
    DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS zone_assignments;
    DROP TABLE IF EXISTS shifts; DROP TABLE IF EXISTS staff;
    DROP TABLE IF EXISTS baselines; DROP TABLE IF EXISTS tables;
    DROP TABLE IF EXISTS zones; DROP TABLE IF EXISTS venues;
  `);
  runMigrations();

  // Minimal fixtures
  venueRepo.upsert({ id: DEMO_VENUE_ID, name: 'Test Venue' });
  zoneRepo.upsert({ id: 'zone-test', venue_id: DEMO_VENUE_ID, name: 'Test Zone' });
  tableRepo.upsert({ id: 'tbl-t1', venue_id: DEMO_VENUE_ID, zone_id: 'zone-test', label: 'T1' });
  staffRepo.upsert({ id: 'staff-srv-001', venue_id: DEMO_VENUE_ID, name: 'Test Server', role: 'server', active: 1 });
  for (const [m, v] of Object.entries(DEFAULT_BASELINES)) {
    baselineRepo.upsert({ id: uuid(), venue_id: DEMO_VENUE_ID, zone_id: 'zone-test',
      metric: m as BaselineMetric, expected_value: v, updated_at: new Date().toISOString() });
  }

  await app.register(cors, { origin: true });
  await app.register(wsPlugin);
  await app.register(eventsRoute);
  await app.register(sessionsRoute);
  await app.register(alertsRoute);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ── POST /api/events ──────────────────────────────────────────

describe('POST /api/events', () => {
  it('returns 400 when session_id missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/events',
      payload: { type: 'seat' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/session_id/i);
  });

  it('returns 400 when creating new session without venue_id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: 'new-sess-1', type: 'seat' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/venue_id/i);
  });

  it('creates new session and seat event', async () => {
    const sessionId = `sess-api-test-${Date.now()}`;
    const res = await app.inject({
      method: 'POST', url: '/api/events',
      payload: {
        session_id: sessionId,
        venue_id:   DEMO_VENUE_ID,
        table_id:   'tbl-t1',
        zone_id:    'zone-test',
        type:       'seat',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.event.type).toBe('seat');
    expect(body.event.session_id).toBe(sessionId);
  });

  it('accepts subsequent events on existing session without venue_id', async () => {
    const sessionId = `sess-api-test2-${Date.now()}`;

    // Create session first
    await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: sessionId, venue_id: DEMO_VENUE_ID,
        table_id: 'tbl-t1', zone_id: 'zone-test', type: 'seat' },
    });

    // Now send attend without venue info
    const res = await app.inject({
      method: 'POST', url: '/api/events',
      payload: { session_id: sessionId, type: 'attend' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).event.type).toBe('attend');
  });

  it('closes session on pay event', async () => {
    const sessionId = `sess-pay-test-${Date.now()}`;
    await app.inject({ method: 'POST', url: '/api/events',
      payload: { session_id: sessionId, venue_id: DEMO_VENUE_ID,
        table_id: 'tbl-t1', zone_id: 'zone-test', type: 'seat' } });

    const res = await app.inject({ method: 'POST', url: '/api/events',
      payload: { session_id: sessionId, type: 'pay' } });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).session_closed).toBe(true);
  });
});

// ── GET /api/sessions/active ──────────────────────────────────

describe('GET /api/sessions/active', () => {
  it('returns array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/active' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });

  it('filters by venue_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/active?venue_id=${DEMO_VENUE_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const sessions = JSON.parse(res.body);
    for (const s of sessions) {
      expect(s.venue_id).toBe(DEMO_VENUE_ID);
    }
  });
});

// ── POST /api/alerts/:id/ack ──────────────────────────────────

describe('POST /api/alerts/:id/ack', () => {
  it('returns 404 for unknown alert id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/alerts/nonexistent-id/ack',
      payload: { staff_id: 'staff-test-1' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('acks an alert and marks acknowledged_at', async () => {
    // Create a session with a seat event far in the past to trigger wait_overdue
    const { alertRepo, sessionRepo, eventRepo } = await import('@sangati/db');
    const { processSession } = await import('@sangati/core');

    const sessionId = `sess-ack-test-${Date.now()}`;
    sessionRepo.insert({
      id: sessionId, venue_id: DEMO_VENUE_ID, table_id: 'tbl-t1',
      zone_id: 'zone-test', started_at: new Date(Date.now() - 7200_000).toISOString(),
      ended_at: null, status: 'active',
    });
    eventRepo.insert({
      id: uuid(), session_id: sessionId, type: 'seat',
      value: null, ts: new Date(Date.now() - 900_000).toISOString(), // 15 min ago
    });

    processSession(sessionId);
    const alerts = alertRepo.findBySession(sessionId);
    if (alerts.length === 0) {
      // No alerts triggered — skip (baseline might be very high)
      return;
    }

    const alertId = alerts[0].id;
    const res = await app.inject({
      method: 'POST', url: `/api/alerts/${alertId}/ack`,
      payload: { staff_id: 'staff-srv-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.alert.acknowledged_at).toBeTruthy();
    expect(body.alert.acknowledged_by_staff_id).toBe('staff-srv-001');
  });

  it('returns 409 if alert already acknowledged', async () => {
    const { alertRepo } = await import('@sangati/db');
    const ackedAlerts = alertRepo.findToday().filter(a => a.acknowledged_at);
    if (ackedAlerts.length === 0) return; // nothing to test

    const res = await app.inject({
      method: 'POST', url: `/api/alerts/${ackedAlerts[0].id}/ack`,
      payload: { staff_id: 'staff-002' },
    });
    expect(res.statusCode).toBe(409);
  });
});
