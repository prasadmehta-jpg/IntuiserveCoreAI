#!/usr/bin/env tsx
/**
 * pnpm sim [--rush] [--sessions=N] [--venue=VENUE_ID]
 *
 * Spawns N realistic sessions through the SANGATI API.
 * Run from repo root: pnpm sim
 */

import 'dotenv/config';

const API  = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3847';
const VENUE = process.argv.find(a => a.startsWith('--venue='))?.split('=')[1] ?? 'venue-demo-001';

const ZONES  = ['zone-floor-a', 'zone-floor-b', 'zone-terrace'];
const TABLES = Array.from({ length: 12 }, (_, i) => `tbl-${String(i + 1).padStart(2, '0')}`);

const RUSH     = process.argv.includes('--rush');
const N_SESSIONS = parseInt(
  process.argv.find(a => a.startsWith('--sessions='))?.split('=')[1] ?? '5',
  10
);

// ── Utility ────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Session Factory ─────────────────────────────────────────────
type EventStep = { type: string; delaySec: number };

function buildEventSequence(rush: boolean): EventStep[] {
  const m = rush ? 2.5 : 1.0;  // multiplier

  const steps: EventStep[] = [
    { type: 'seat',   delaySec: 0 },
  ];

  // Some sessions have attend delayed or missing entirely (attend_overdue scenario)
  const attendDelay = rand(60, 400) * m;
  const skipAttend  = Math.random() < (rush ? 0.35 : 0.10);
  if (!skipAttend) {
    steps.push({ type: 'attend', delaySec: attendDelay });
  }

  // Add call event occasionally
  if (Math.random() < 0.20) {
    steps.push({ type: 'call', delaySec: attendDelay * 0.6 });
  }

  steps.push({ type: 'order', delaySec: rand(30, 120) });

  // Kitchen delay: sometimes very long (kitchen_overdue scenario)
  const kitchenDelay = rand(300, 600) * m;
  const skipServe    = Math.random() < (rush ? 0.25 : 0.05);
  if (!skipServe) {
    steps.push({ type: 'serve', delaySec: kitchenDelay });
  }

  steps.push({ type: 'bill', delaySec: rand(60, 180) });

  // Bill sometimes stays open long (bill_overdue scenario)
  const payDelay = rand(60, 200) * m;
  const skipPay  = Math.random() < (rush ? 0.20 : 0.05);
  if (!skipPay) {
    steps.push({ type: 'pay', delaySec: payDelay });
  }

  return steps;
}

// ── Run one session ─────────────────────────────────────────────
async function runSession(i: number): Promise<void> {
  const sessionId = `sim-sess-${uuid()}`;
  const tableId   = TABLES[i % TABLES.length];
  const zoneId    = ZONES[i % ZONES.length];
  const steps     = buildEventSequence(RUSH);

  // Convert relative delays to absolute (cumulative)
  let cursor = 0;
  const timeline: { type: string; atMs: number }[] = [];
  for (const step of steps) {
    cursor += step.delaySec * 1000;
    timeline.push({ type: step.type, atMs: cursor });
  }

  const sessionLabel = `[sess ${String(i + 1).padStart(2, '0')} ${sessionId.slice(0, 8)}]`;
  console.log(`${sessionLabel} → ${tableId} / ${zoneId} (${steps.length} events, ${RUSH ? 'RUSH' : 'normal'})`);

  for (const { type, atMs } of timeline) {
    await sleep(atMs === 0 ? 0 : Math.min(atMs, 2_000)); // speed up for demo: cap at 2s per step

    try {
      const result = await post('/api/events', {
        session_id: sessionId,
        venue_id:   VENUE,
        table_id:   tableId,
        zone_id:    zoneId,
        type,
      }) as { new_alerts?: number };

      const alertNote = result.new_alerts ? ` 🔔 +${result.new_alerts} alert` : '';
      console.log(`  ${sessionLabel} [${type}]${alertNote}`);
    } catch (err) {
      console.error(`  ${sessionLabel} [${type}] ERROR:`, (err as Error).message);
    }
  }

  console.log(`  ${sessionLabel} ✓ complete`);
}

// ── Main ───────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n🍽  SANGATI Simulator`);
  console.log(`   API:      ${API}`);
  console.log(`   Venue:    ${VENUE}`);
  console.log(`   Sessions: ${N_SESSIONS}`);
  console.log(`   Mode:     ${RUSH ? '🔥 RUSH HOUR' : 'Normal'}`);
  console.log('');

  // Health check
  try {
    const hres = await fetch(`${API}/health`);
    if (!hres.ok) throw new Error('not OK');
    console.log('✓ API reachable\n');
  } catch {
    console.error('✗ API not reachable at', API);
    console.error('  Run: pnpm dev (in another terminal)\n');
    process.exit(1);
  }

  // Run sessions with staggered starts
  const promises: Promise<void>[] = [];
  for (let i = 0; i < N_SESSIONS; i++) {
    const startDelay = i * 1500;
    promises.push(
      sleep(startDelay).then(() => runSession(i))
    );
  }

  await Promise.allSettled(promises);
  console.log('\n✅  Simulation complete.');
}

main().catch(err => {
  console.error('Sim error:', err);
  process.exit(1);
});
