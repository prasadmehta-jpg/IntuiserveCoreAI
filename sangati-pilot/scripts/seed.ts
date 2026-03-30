#!/usr/bin/env tsx
/**
 * pnpm db:seed
 * Populates the database with a demo venue ready for the pilot.
 * Safe to run multiple times (upsert / insert-or-ignore pattern).
 * Run from repo root: pnpm db:seed
 */

import 'dotenv/config';
import path from 'path';

process.env.DATABASE_PATH ??= path.resolve(process.cwd(), 'data/sangati.db');

import { v4 as uuid } from 'uuid';
import { runMigrations } from '../packages/db/src/migrations';
import {
  venueRepo, zoneRepo, tableRepo,
  staffRepo, shiftRepo, zoneAssignmentRepo,
  baselineRepo,
} from '../packages/db/src/db';
import { DEMO_VENUE_ID, DEMO_ZONE_IDS, DEFAULT_BASELINES } from '../packages/shared/src/constants';
import type { BaselineMetric } from '../packages/shared/src/types';

// ── Ensure schema exists ──────────────────────────────────────
runMigrations();

const now       = new Date();
const dayStart  = new Date(now); dayStart.setHours(6, 0, 0, 0);
const dayEnd    = new Date(now); dayEnd.setHours(23, 59, 59, 999);
const nowIso    = now.toISOString();

// ── 1. Venue ─────────────────────────────────────────────────
venueRepo.upsert({ id: DEMO_VENUE_ID, name: 'Demo Restaurant' });
console.log('✓ Venue');

// ── 2. Zones ─────────────────────────────────────────────────
const zoneNames: Record<string, string> = {
  'zone-floor-a': 'Floor A',
  'zone-floor-b': 'Floor B',
  'zone-terrace': 'Terrace',
};
for (const zoneId of DEMO_ZONE_IDS) {
  zoneRepo.upsert({ id: zoneId, venue_id: DEMO_VENUE_ID, name: zoneNames[zoneId] });
}
console.log('✓ Zones (3)');

// ── 3. Tables ─────────────────────────────────────────────────
// 4 tables per zone
const tables = [
  { id: 'tbl-01', zone_id: 'zone-floor-a', label: 'T1' },
  { id: 'tbl-02', zone_id: 'zone-floor-a', label: 'T2' },
  { id: 'tbl-03', zone_id: 'zone-floor-a', label: 'T3' },
  { id: 'tbl-04', zone_id: 'zone-floor-a', label: 'T4' },
  { id: 'tbl-05', zone_id: 'zone-floor-b', label: 'T5' },
  { id: 'tbl-06', zone_id: 'zone-floor-b', label: 'T6' },
  { id: 'tbl-07', zone_id: 'zone-floor-b', label: 'T7' },
  { id: 'tbl-08', zone_id: 'zone-floor-b', label: 'T8' },
  { id: 'tbl-09', zone_id: 'zone-terrace', label: 'TR1' },
  { id: 'tbl-10', zone_id: 'zone-terrace', label: 'TR2' },
  { id: 'tbl-11', zone_id: 'zone-terrace', label: 'TR3' },
  { id: 'tbl-12', zone_id: 'zone-terrace', label: 'TR4' },
];
for (const t of tables) {
  tableRepo.upsert({ ...t, venue_id: DEMO_VENUE_ID });
}
console.log('✓ Tables (12)');

// ── 4. Staff ─────────────────────────────────────────────────
const staffMembers = [
  { id: 'staff-mgr-01',  name: 'Ananya Singh',  role: 'manager' as const },
  { id: 'staff-srv-01',  name: 'Rohit Sharma',  role: 'server'  as const },
  { id: 'staff-srv-02',  name: 'Priya Mehta',   role: 'server'  as const },
  { id: 'staff-srv-03',  name: 'Vikram Patel',  role: 'server'  as const },
  { id: 'staff-kitch-01',name: 'Chef Suresh',   role: 'kitchen' as const },
  { id: 'staff-kitch-02',name: 'Chef Ravi',     role: 'kitchen' as const },
  { id: 'staff-bar-01',  name: 'Deepak Kumar',  role: 'bar'     as const },
];
for (const s of staffMembers) {
  staffRepo.upsert({ ...s, venue_id: DEMO_VENUE_ID, active: 1 });
}
console.log('✓ Staff (7)');

// ── 5. Shifts (today full day) ────────────────────────────────
const shifts = staffMembers.map(s => ({
  id:        `shift-${s.id}-today`,
  venue_id:  DEMO_VENUE_ID,
  staff_id:  s.id,
  starts_at: dayStart.toISOString(),
  ends_at:   dayEnd.toISOString(),
}));
for (const sh of shifts) {
  // Only insert if not exists (no upsert on shifts — just skip)
  try { shiftRepo.insert(sh); } catch { /* already exists */ }
}
console.log('✓ Shifts (7)');

// ── 6. Zone Assignments ───────────────────────────────────────
const assignments = [
  { staff_id: 'staff-srv-01', zone_id: 'zone-floor-a' },
  { staff_id: 'staff-srv-02', zone_id: 'zone-floor-b' },
  { staff_id: 'staff-srv-03', zone_id: 'zone-terrace' },
  { staff_id: 'staff-mgr-01', zone_id: 'zone-floor-a' }, // manager covers all
  { staff_id: 'staff-mgr-01', zone_id: 'zone-floor-b' },
  { staff_id: 'staff-mgr-01', zone_id: 'zone-terrace' },
];
for (const a of assignments) {
  const shiftId = `shift-${a.staff_id}-today`;
  try {
    zoneAssignmentRepo.insert({
      id:       uuid(),
      venue_id: DEMO_VENUE_ID,
      zone_id:  a.zone_id,
      staff_id: a.staff_id,
      shift_id: shiftId,
    });
  } catch { /* already exists */ }
}
console.log('✓ Zone Assignments');

// ── 7. Default Baselines (all zones) ─────────────────────────
const metrics: BaselineMetric[] = ['attend_latency_sec', 'kitchen_latency_sec', 'bill_latency_sec'];
for (const zoneId of DEMO_ZONE_IDS) {
  for (const metric of metrics) {
    baselineRepo.upsert({
      id:             uuid(),
      venue_id:       DEMO_VENUE_ID,
      zone_id:        zoneId,
      metric,
      expected_value: DEFAULT_BASELINES[metric],
      updated_at:     nowIso,
    });
  }
}
console.log('✓ Baselines (9 — 3 zones × 3 metrics)');

console.log('\n✅  Seed complete. Ready to run: pnpm dev');
