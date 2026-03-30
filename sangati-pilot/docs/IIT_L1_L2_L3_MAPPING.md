# IIT L1 / L2 / L3 — SANGATI Implementation Map

> This document maps the IIT Bombay intelligence maturity framework
> to every file, table, and function in the SANGATI Phase-1 codebase.

---

## The Hierarchy

```
L3  ┌──────────────────────────────────┐  ← deviation intelligence
    │  Is this normal or a problem?    │
    └──────────────────────────────────┘
L2  ┌──────────────────────────────────┐  ← structural intelligence
    │  Why did it happen here?         │
    └──────────────────────────────────┘
L1  ┌──────────────────────────────────┐  ← data discipline
    │  Do we even know what happened?  │
    └──────────────────────────────────┘
```

---

## L1 — Data Discipline

**Question answered:** "What happened, exactly?"

### Tables

| Table | Purpose |
|-------|---------|
| `sessions` | Every dining session: who, where, when started, when closed |
| `events`   | Every timestamped event within a session |

### Event Types

```
seat   → guest seated at table (timestamp = session truth)
attend → staff acknowledged table
order  → order placed
serve  → food/drink delivered
bill   → bill requested
pay    → payment completed
call   → guest called for attention
note   → free-form note
```

### What L1 enables

```sql
-- Raw reality: how long before attend?
SELECT
  (strftime('%s', e2.ts) - strftime('%s', e1.ts)) AS attend_latency_sec
FROM events e1
JOIN events e2 ON e2.session_id = e1.session_id
WHERE e1.type = 'seat' AND e2.type = 'attend'
  AND e1.session_id = 'sess-001';
```

### Code locations
- Schema: `packages/db/src/schema.ts` — `sessions`, `events` table DDL
- Repos:  `packages/db/src/db.ts` — `sessionRepo`, `eventRepo`
- Ingest: `apps/api/src/routes/events.ts` — `POST /api/events`

### L1 failure mode (what we avoided)
> "Table waited too long." — no timestamp, no session, no event.
> That is storytelling, not data.

---

## L2 — Structural Intelligence

**Question answered:** "Why did it happen here?"

### Tables

| Table | Purpose |
|-------|---------|
| `staff`            | Non-biometric staff registry with role |
| `shifts`           | When each staff member is on duty |
| `zone_assignments` | Which staff covers which zone during which shift |
| `zones`            | Physical floor zones |
| `tables`           | Physical tables, each belonging to a zone |

### Relationships

```
venue → zone → table
venue → zone → zone_assignment → shift → staff
session → table → zone → zone_assignment → staff
alert → session → zone → zone_assignment → (who is responsible?)
```

### What L2 enables

- **Zone overload detection:** Count active sessions per zone
- **Staff routing:** When alert fires for `zone-floor-a`, find which server
  is on shift for `zone-floor-a` right now → route only to them
- **Shift-aware escalation:** No server on zone? → route to manager

### Code locations
- Schema:  `packages/db/src/schema.ts` — `staff`, `shifts`, `zone_assignments`
- Repos:   `packages/db/src/db.ts` — `staffRepo`, `shiftRepo`, `zoneAssignmentRepo`
- Router:  `packages/core/src/alertRouter.ts` — `resolveRoutingRole()`
- Setup:   `apps/api/src/routes/setup.ts` — `POST /api/setup/staff|shifts|zone-assignments`

### L2 failure mode (what we avoided)
> Broadcasting an alert to all staff.
> Without L2, you cannot answer "who is responsible for this table right now?"

---

## L3 — Deviation Intelligence

**Question answered:** "Is this normal or a problem?"

### Tables

| Table | Purpose |
|-------|---------|
| `baselines`         | Rolling expected values per venue + zone + metric |
| `session_features`  | Derived metrics per session (computed from events) |
| `decisions`         | Explainability: reason string for every alert |
| `alerts`            | Routed, severity-classified, acknowledgeable notifications |

### The Comparison Formula

```
actual > expected × 1.5   OR   actual − expected > 180s
→ trigger alert
```

### Severity Classification

```
ratio = actual / expected

ratio ≥ 1.80  →  HIGH   (> 80% over)
ratio ≥ 1.30  →  MED    (30–80% over)
ratio ≥ 1.10  →  LOW    (10–30% over)
```

### Concrete Example

```
seat event:  19:02:00
now:         19:14:00
actual:      720 seconds
expected:    300 seconds (baseline)

deviation:   +420s  (+140%)
severity:    HIGH

decision reason:
  "Attend latency 720s > expected 300s (+420s, +140%)."
```

### Baseline Learning

After each closed session, the rolling average is recomputed:

```
1. Fetch last 30 closed sessions for venue+zone
2. Extract attend / kitchen / bill latencies
3. Average (clamped to 20%–500% of default)
4. Upsert into baselines table
5. Broadcast baseline.updated via WebSocket
```

Minimum 5 sessions required before defaults are overridden.

### Code locations
- Engine:   `packages/core/src/deviationEngine.ts` — pure function, no side effects
- Updater:  `packages/core/src/baselineUpdater.ts` — rolling average recomputation
- Computer: `packages/core/src/featureComputer.ts` — orchestrates engine + DB writes
- Ticker:   `apps/api/src/ticker.ts` — calls `processAllActiveSessions` every 15s

### L3 failure mode (what we avoided)
> Alerting on every late event without baseline context.
> Without L3, you cannot distinguish "8 minutes is normal here" from "8 minutes is a problem."

---

## The Full Stack, Layer by Layer

```
Event ingested (POST /api/events)
        │
        ▼
[L1] eventRepo.insert()
     sessionRepo.insert() if new
        │
        ▼
[L2] resolveRoutingRole()
     ← zoneAssignmentRepo.findStaffForZone()
        │
        ▼
[L3] computeDeviations()
     ← baselineRepo.findByVenueZone()
     → actual vs expected → severity
     → AlertDraft[] + DecisionDraft[]
        │
        ▼
[DB]  alertRepo.insert()
      decisionRepo.insert()
      featureRepo.upsert()
        │
        ▼
[WS]  broadcast('alert.created', alert)
        │
        ▼
[UI]  Role view refreshes
      Server taps Done → ackAlert()
```

---

## Why This Order Is Non-Negotiable

```
L1 without L2 = clean but isolated data (can't answer "who is responsible?")
L2 without L3 = structured but passive (detects nothing, just stores)
L3 without L1 = garbage conclusions (no timestamps = no actual latency)
```

This is not philosophy. It is architecture.
Every premature ML layer built on weak L1/L2 will fail in production.
