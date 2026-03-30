# SANGATI — Phase-1 Pilot

> Real-time deviation detection + smart nudge engine for restaurant operations.
> **No guest profiling. No biometrics. No data leaves the building.**

---

## What It Does

Monitors active dining sessions and detects service deviations *before* a guest has to ask.
Auto-posts events from CCTV (vision agents) and POS (Petpooja) — staff intervention optional.

```
Detect → Understand → Act → Improve
```

---

## Quick Start

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm golden        # validates pipeline — 16/16 must pass
pnpm dev           # API :3847  +  Web :3000
```

Stress test:
```bash
pnpm sim --rush    # 2.5× delays → triggers all alert types
```

---

## Role-Based Views

| URL | Who | Purpose |
|-----|-----|---------|
| `/manager`  | Manager | KPIs · zone health · active alerts · close sessions |
| `/server`   | Server  | Action feed · 1-tap acknowledge |
| `/kitchen`  | Kitchen | Prioritised overdue queue |
| `/bar`      | Bar     | Prioritised bar queue |
| `/staff`    | All staff | **Event tapper** — log seat/attend/order/serve/bill/pay/call |
| `/revenue`  | Owner   | **Savings calculator** — 5-question ROI tool |
| `/cameras`  | Manager | **CCTV** — discover cameras, map zones, start/stop agents |
| `/pos`      | Manager | **POS** — connect Petpooja, monitor auto-ingestion |
| `/setup`    | Admin   | Staff registration, shifts, zone assignments |
| `/demo`     | All     | Simulator with rush-hour toggle |

---

## Alert Types

| Alert | Trigger | Routes To |
|-------|---------|-----------|
| `wait_overdue`    | Seat → no attend within expected | Server → Manager if no server on zone |
| `kitchen_overdue` | Order → no serve within expected | Kitchen |
| `bill_overdue`    | Bill → no pay (escalates to Manager after 2nd alert) | Server → Manager |
| `call_pending`    | Guest call unanswered >expected (Manager at 2× expected) | Server → Manager |

**Severity:** low (>10%) · med (>30%) · high (>80% over expected)

---

## Commands

```bash
pnpm dev           # API + Web
pnpm db:migrate    # schema (idempotent)
pnpm db:seed       # demo data
pnpm sim           # event simulator
pnpm golden        # 16-case pipeline validation
pnpm test          # 15 unit tests (deviation engine)
```

---

## Vision Agents (CCTV)

Two Python agents, zero native compilation required:

```bash
cd agents/vision
pip install -r requirements.txt
python main.py                   # starts on port 3849
```

**Agent 20A — Camera Discovery**
- Scans LAN via ONVIF WS-Discovery + RTSP port scan (port 554/8554)
- Auto-detects Hikvision, Dahua, Axis manufacturers
- Results visible in `/cameras` UI

**Agent 20B — Vision Analytics**
- Connects to RTSP stream, samples at 1 FPS
- YOLOv8n person detection (runs on CPU)
- Maps detections to table zones
- Auto-posts `seat` event when table occupied, `pay` when empty
- Posts to SANGATI API — no human input required

---

## POS Integration (Petpooja)

Configure via `/pos` UI or API:

```bash
curl -X POST http://localhost:3847/api/pos/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "base_url":      "http://192.168.1.50:8080",
    "api_key":       "your-petpooja-key",
    "restaurant_id": "your-restaurant-id",
    "venue_id":      "venue-demo-001",
    "poll_interval": 10000
  }'
```

POS event mapping:
- Order placed → `order` event
- Order served → `serve` event
- Bill generated → `bill` event
- Payment received → `pay` event

---

## WebSocket Events

Connect to `ws://localhost:3847/ws`

```json
{ "type": "alert.created",      "payload": Alert   }
{ "type": "alert.acknowledged", "payload": Alert   }
{ "type": "session.updated",    "payload": Session }
{ "type": "baseline.updated",   "payload": Baseline }
```

---

## Architecture

```
sangati-pilot/
├── apps/
│   ├── api/        Fastify REST + WebSocket (port 3847)
│   └── web/        Next.js 10-page role UI (port 3000)
├── packages/
│   ├── shared/     Types + constants
│   ├── db/         node:sqlite schema + typed repos
│   └── core/       Deviation engine + baseline updater + routing
├── agents/
│   └── vision/     Python CCTV agents (port 3849)
├── integrations/
│   └── pos/        Petpooja bridge
├── scripts/        migrate · seed · sim · golden-run
└── data/           sangati.db (runtime)
```

**One brain, multiple faces.**
The deviation engine in `packages/core` is the single source of logic.
Every role view and every agent feeds the same database via the same API.

---

## IIT L1 / L2 / L3 Framework

| Layer | Principle | Implementation |
|-------|-----------|----------------|
| **L1** | Record reality properly | `sessions` + `events` tables with timestamps |
| **L2** | Understand structure | `staff` · `shifts` · `zone_assignments` · relational routing |
| **L3** | Detect abnormality | `baselines` · deviation engine · severity classification |

See `docs/IIT_L1_L2_L3_MAPPING.md` for full mapping.

---

## Pilot Sequencing

```
Day  1     Install + seed + set real baselines from 2h observation
Day  1–30  Rules-only: default baselines, manual event logging
Day 31+    Baseline learning activates (needs ≥5 closed sessions/zone)
Day 61     Validate learned baselines vs observed actuals
Day 91     Demand forecaster scaffolding (post-pilot)
```
