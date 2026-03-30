# DECISIONS_NEEDED.md

> Tracks every decision made during the Phase-1 build that was resolved with a
> best-practice default, plus items that require a real-venue decision before
> or during pilot.

---

## AUTO-DECISIONS (made during build — can be changed)

### DB-001 — SQLite WAL mode enabled
**Decision:** WAL (Write-Ahead Log) mode is on by default.
**Why:** WAL allows concurrent reads while writing. Better for pilot where API
writes events while web reads sessions simultaneously.
**Change if:** Multiple machines need to access the same DB simultaneously
(upgrade to PostgreSQL then).

### DB-002 — DATA_PATH = `./data/sangati.db`
**Decision:** DB file stored at `./data/sangati.db` relative to repo root.
**Change if:** You want to place the DB on a separate drive or share it.
Update `DATABASE_PATH` in `.env`.

### ENG-001 — DEDUP_WINDOW_SEC = 300 (5 minutes)
**Decision:** Same alert type won't re-fire within 5 minutes for the same session.
**Why:** Prevents alert spam when ticker runs every 15 seconds.
**Change if:** Venue wants more frequent re-alerts. Set in `packages/shared/src/constants.ts`.

### ENG-002 — MAX_ALERTS_PER_SESSION_PER_TYPE = 3
**Decision:** Hard cap of 3 alerts of the same type per session.
**Why:** Prevents a single slow session from dominating the alert feed.
**Change if:** Venue wants unlimited escalation. Set in constants.ts.

### ENG-003 — TICK_INTERVAL_MS = 15,000 (15 seconds)
**Decision:** Deviation engine evaluates all active sessions every 15 seconds.
**Why:** Balance between responsiveness and CPU load on pilot hardware.
**Change if:** Requires near-realtime (<5s). Set in constants.ts. Monitor CPU.

### ENG-004 — ALERT_TRIGGER_RATIO = 1.5 (50% over expected)
**Decision:** Alert fires when actual > expected × 1.5 OR actual − expected > 3 min.
**Why:** Avoids noise from small delays while catching real deviations.
**Change if:** Too many false positives → raise to 1.8. Too many misses → lower to 1.3.

### ENG-005 — Default baselines
```
attend_latency_sec:  300s (5 min)
kitchen_latency_sec: 900s (15 min)
bill_latency_sec:    240s (4 min)
```
**Change if:** Venue's natural pace is different. Update via SQL on Day 1.

### ENG-006 — BASELINE_MIN_SAMPLES = 5
**Decision:** Minimum 5 closed sessions before learned baseline overrides default.
**Why:** Avoid learning from a single rush-hour anomaly.
**Change if:** Venue wants faster learning. Lower to 3. Slower → raise to 10.

### API-001 — API port 3847
**Decision:** Port chosen to avoid conflict with common dev ports.
**Change if:** Port is in use. Update `API_PORT` in `.env`.

### UI-001 — No authentication in pilot
**Decision:** No login screen. Role switching via dropdown.
**Why:** Reduces pilot friction. Operators learn the system without login barriers.
**Change after pilot:** Add PIN or simple token-based auth per device.

### UI-002 — Poll fallback every 8–20 seconds per view
**Decision:** All views poll the API as a WebSocket fallback.
**Why:** WebSocket connections can drop on mobile networks.

---

## OPEN DECISIONS — Require venue input before/during pilot

### VENUE-001 — Actual service timing baselines
The defaults (5 min attend, 15 min kitchen, 4 min bill) may be wrong for this venue.

**Question:** What are the actual expected times for:
- Seat → first staff acknowledgement?
- Order placed → food delivered?
- Bill requested → payment received?

**Action:** Measure manually for the first 3 days. Update baselines in SQL.
Update `DEFAULT_BASELINES` in `constants.ts` for future fresh installs.

### VENUE-002 — Zone layout
Current seed creates 3 zones: `Floor A`, `Floor B`, `Terrace`.

**Question:** How many zones? What are they called?

**Action:** Update `zoneNames` in `scripts/seed.ts` and `DEMO_ZONE_IDS` in constants.ts.

### VENUE-003 — Table count and layout
Current seed creates 12 tables (4 per zone).

**Action:** Update `tables` array in `scripts/seed.ts` with actual table IDs and labels.

### VENUE-004 — Event ingestion method
Currently: events are manually posted via API (simulator, direct API calls).

**Question:** How will staff log events?
- Option A: Dedicated staff tablet with a simple tap interface (needs `apps/staff` page — not yet built)
- Option B: Manager taps on manager screen to close/update sessions
- Option C: POS integration (Petpooja) that auto-posts events — post-pilot

**Action:** For pilot, use Option B or build a minimal tapper UI before Day 1.

### VENUE-005 — Bill event trigger
The `bill` event must be logged when a guest requests the bill.

**Question:** How will this be captured?
- Staff tap a button on their phone when guest asks for bill?
- Manager logs it on tablet?

**Action:** Build a minimal "log event" component for staff phones before pilot.

---

## DEFERRED POST-PILOT

### POST-001 — POS Integration (Petpooja)
Petpooja sends webhooks or supports polling for order events.
When connected: `order` and `serve` events auto-ingest.
Implement after pilot confirms value.

### POST-002 — Warm-standby failover laptop
Second laptop on the same network, ~30-second failover.
Architecture: rsync SQLite WAL file every 30 seconds.
Deferred until pilot validates the concept is worth protecting.

### POST-003 — Zone edit/resize in UI
Drag-and-drop zone layout tool on the setup page.
Currently: zones are created via seed script only.

### POST-004 — Zone-type alert routing
Some alert types should route differently based on zone type (outdoor vs indoor).
Currently: all zones use the same routing logic.

### POST-005 — Staff tapper UI
Simple phone UI for staff to log: seat, attend, order, serve, bill, pay, call.
One tap per event. Currently missing — pilot workaround: manager logs events on tablet.
Build as `/staff` route before Day 1 of real pilot.

### POST-006 — Demand forecaster
Phase 3: predict busy periods based on historical session patterns.
Activate scaffolding at Day 91.

### POST-007 — Multi-venue dashboard
Central view across multiple venues.
Deferred until 3+ venues on pilot.

### POST-008 — PIN auth per device
Simple 4-digit PIN per role (server PIN, kitchen PIN, manager PIN).
Deferred until post-pilot.

---

## KNOWN ISSUES

### ISSUE-001 — Electron `.exe` launcher (sangati-run)
**Status:** Active workaround exists, not permanently fixed.
**Symptom:** Electron opens Chrome before backend is ready → "site can't be reached".
**Workaround:** Wait 5–8 seconds before clicking anything after launch.
**Fix:** Add a startup health-poll loop in the Electron main process before showing the window.

### ISSUE-002 — better-sqlite3 on Windows requires build tools
**Symptom:** `pnpm install` fails with node-gyp error on Windows.
**Fix:**
```
npm install --global windows-build-tools
```
Or install via: Visual Studio Build Tools → Desktop development with C++.

### ISSUE-003 — TypeScript path aliases in scripts
**Symptom:** tsx can't resolve `@sangati/shared` etc. in scripts if run outside repo root.
**Fix:** Always run scripts from repo root: `cd sangati-pilot && pnpm db:seed`.
