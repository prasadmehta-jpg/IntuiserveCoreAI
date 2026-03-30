/**
 * SANGATI — Petpooja POS Integration
 *
 * Polls Petpooja's local API for new orders and status updates.
 * Translates POS events to SANGATI events and POSTs to the local API.
 *
 * Event mapping:
 *   POS: order placed     → SANGATI: 'order'
 *   POS: order delivered  → SANGATI: 'serve'
 *   POS: bill generated   → SANGATI: 'bill'
 *   POS: payment received → SANGATI: 'pay'
 *
 * Petpooja exposes a local REST API on the venue's LAN.
 * Credentials: API key + restaurant ID (entered once in Setup).
 */

import type { IngestEventBody } from '@sangati/shared';

const SANGATI_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3847';

export interface PetpoojaConfig {
  base_url:       string;   // e.g. http://192.168.1.50:8080
  api_key:        string;
  restaurant_id:  string;
  venue_id:       string;
  poll_interval:  number;   // ms, default 10000
}

interface PetpoojaOrder {
  orderid:     string;
  tableno:     string;
  status:      'placed' | 'in_kitchen' | 'served' | 'billed' | 'paid' | 'cancelled';
  items:       unknown[];
  updated_at:  string;
}

// Track last-seen status per order to detect transitions
const seenOrders = new Map<string, PetpoojaOrder['status']>();
let   pollHandle: ReturnType<typeof setInterval> | null = null;
let   cfg: PetpoojaConfig | null = null;

// ── Table → session ID mapping ────────────────────────────────

function sessionId(tableNo: string, date: string): string {
  return `sess-${date}-tbl-${tableNo.padStart(2, '0')}`;
}

function tableId(tableNo: string): string {
  return `tbl-${tableNo.padStart(2, '0')}`;
}

// ── Petpooja API call ─────────────────────────────────────────

async function fetchOrders(config: PetpoojaConfig): Promise<PetpoojaOrder[]> {
  const url = `${config.base_url}/api/orders/active?restaurant_id=${config.restaurant_id}`;
  const res = await fetch(url, {
    headers: {
      'X-API-Key':      config.api_key,
      'Content-Type':   'application/json',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Petpooja API ${res.status}`);
  const data = await res.json() as { orders?: PetpoojaOrder[] };
  return data.orders ?? [];
}

// ── Event posting ─────────────────────────────────────────────

async function postEvent(body: IngestEventBody): Promise<void> {
  await fetch(`${SANGATI_API}/api/events`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── Status → SANGATI event mapping ───────────────────────────

async function processOrder(
  order: PetpoojaOrder,
  config: PetpoojaConfig,
): Promise<void> {
  const prev    = seenOrders.get(order.orderid);
  const current = order.status;

  if (prev === current) return; // No change
  seenOrders.set(order.orderid, current);

  const today   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sessId  = sessionId(order.tableno, today);
  const tblId   = tableId(order.tableno);

  // Determine which SANGATI event to post based on transition
  const eventsToPost: string[] = [];

  if (!prev) {
    // First time seeing this order
    if (current === 'placed')    eventsToPost.push('order');
    if (current === 'in_kitchen') eventsToPost.push('order');
    if (current === 'served')    eventsToPost.push('order', 'serve');
    if (current === 'billed')    eventsToPost.push('order', 'serve', 'bill');
    if (current === 'paid')      eventsToPost.push('order', 'serve', 'bill', 'pay');
  } else {
    // Transition-based events
    if (prev === 'placed'     && current === 'in_kitchen') eventsToPost.push(/* already posted 'order' */ );
    if (prev === 'in_kitchen' && current === 'served')     eventsToPost.push('serve');
    if (prev === 'served'     && current === 'billed')     eventsToPost.push('bill');
    if (prev === 'billed'     && current === 'paid')       eventsToPost.push('pay');
    // Direct jumps
    if (current === 'served' && !['in_kitchen'].includes(prev)) eventsToPost.push('serve');
    if (current === 'paid')  eventsToPost.push('pay');
  }

  // Deduplicate and post
  const unique = [...new Set(eventsToPost)];
  for (const type of unique) {
    try {
      await postEvent({
        session_id: sessId,
        venue_id:   config.venue_id,
        table_id:   tblId,
        zone_id:    `zone-floor-a`, // Default zone — can be overridden via zone mapping
        type:       type as IngestEventBody['type'],
      });
      console.log(`[pos] ${order.tableno} ${prev ?? 'new'} → ${current} → ${type}`);
    } catch (err) {
      console.warn(`[pos] Failed to post ${type}:`, (err as Error).message);
    }
  }
}

// ── Poll loop ─────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (!cfg) return;
  try {
    const orders = await fetchOrders(cfg);
    for (const order of orders) {
      await processOrder(order, cfg);
    }
  } catch (err) {
    console.warn('[pos] Poll error:', (err as Error).message);
  }
}

// ── Public API ────────────────────────────────────────────────

export function startPOSBridge(config: PetpoojaConfig): void {
  cfg = config;
  if (pollHandle) clearInterval(pollHandle);
  const interval = config.poll_interval ?? 10_000;
  pollHandle = setInterval(poll, interval);
  poll(); // immediate first poll
  console.log(`[pos] Petpooja bridge started (polling every ${interval / 1000}s)`);
}

export function stopPOSBridge(): void {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  cfg = null;
  seenOrders.clear();
  console.log('[pos] Petpooja bridge stopped');
}

export function getPOSStatus(): {
  running:     boolean;
  config:      Omit<PetpoojaConfig, 'api_key'> | null;
  orders_seen: number;
} {
  return {
    running:     pollHandle !== null,
    config:      cfg ? { ...cfg, api_key: '***' } : null,
    orders_seen: seenOrders.size,
  };
}
