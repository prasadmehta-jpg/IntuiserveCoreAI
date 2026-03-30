# SANGATI API Reference

Base URL: `http://localhost:3847`

All endpoints return JSON. Errors return `{ "error": "message" }`.

---

## Health

### GET /health
```json
{ "ok": true, "ts": "2024-01-15T14:30:00Z", "ws_clients": 3 }
```

---

## Events

### POST /api/events
Ingest a single event. Auto-creates session if `session_id` is new.
Runs deviation engine synchronously. Returns any new alerts triggered.

**Body:**
```json
{
  "session_id": "sess-abc123",
  "venue_id":   "venue-demo-001",
  "table_id":   "tbl-01",
  "zone_id":    "zone-floor-a",
  "type":       "seat",
  "value":      null,
  "ts":         "2024-01-15T14:30:00Z"
}
```

- `venue_id`, `table_id`, `zone_id` — required only when creating a **new** session
- `ts` — defaults to server time if omitted
- `type` — one of: `seat | attend | order | serve | bill | pay | call | note`

**Response:**
```json
{
  "ok": true,
  "event": { "id": "...", "session_id": "...", "type": "seat", "ts": "..." },
  "new_alerts": 0
}
```

When `type = "pay"`, session is auto-closed and baselines are updated:
```json
{ "ok": true, "event": {...}, "session_closed": true }
```

---

## Sessions

### GET /api/sessions/active?venue_id=
Returns all active sessions enriched with zone name, alert counts, last event.

**Response:**
```json
[
  {
    "id": "sess-001",
    "venue_id": "venue-demo-001",
    "table_id": "tbl-01",
    "zone_id": "zone-floor-a",
    "zone_name": "Floor A",
    "started_at": "2024-01-15T14:00:00Z",
    "ended_at": null,
    "status": "active",
    "active_alerts": 2,
    "highest_severity": "high",
    "last_event_type": "order",
    "last_event_ts": "2024-01-15T14:25:00Z",
    "event_count": 3
  }
]
```

### GET /api/sessions/:id
Full session detail including events, features, alerts, decisions.

### POST /api/sessions/:id/close
Manually close a session and trigger baseline update.

---

## Alerts

### GET /api/alerts/active?role=&zone_id=
Active (unacknowledged) alerts. Both query params are optional.

- `role` — filter by routed role: `server | manager | kitchen | bar`
- `zone_id` — filter by zone

**Response:** Array of `AlertWithContext`:
```json
[
  {
    "id": "alert-001",
    "session_id": "sess-001",
    "severity": "high",
    "type": "wait_overdue",
    "message": "Table unattended 720s (expected 300s)",
    "created_at": "2024-01-15T14:35:00Z",
    "acknowledged_at": null,
    "acknowledged_by_staff_id": null,
    "routed_to_role": "server",
    "routed_to_zone_id": "zone-floor-a",
    "zone_name": "Floor A",
    "table_label": "tbl-01",
    "session_started_at": "2024-01-15T14:00:00Z"
  }
]
```

### GET /api/alerts/all?venue_id=
All alerts for today (acknowledged + unacknowledged).

### POST /api/alerts/:id/ack
Acknowledge an alert. Broadcasts `alert.acknowledged` via WebSocket.

**Body:** `{ "staff_id": "staff-srv-01" }`

**Response:** `{ "ok": true, "alert": { ...updatedAlert } }`

---

## KPIs

### GET /api/kpis?venue_id=
Operational KPIs for today. Venue filter is optional.

**Response:**
```json
{
  "avg_attend_latency_sec":            247,
  "avg_kitchen_delay_sec":             612,
  "alerts_per_hour":                   3.2,
  "sessions_with_multiple_alerts_pct": 18,
  "avg_ack_latency_sec":               94,
  "active_sessions":                   7,
  "total_alerts_today":                14
}
```

---

## Baselines

### GET /api/baselines?venue_id=&zone_id=
Current baseline values. Both params optional — returns all if omitted.

**Response:**
```json
[
  {
    "id": "bl-001",
    "venue_id": "venue-demo-001",
    "zone_id": "zone-floor-a",
    "metric": "attend_latency_sec",
    "expected_value": 300,
    "updated_at": "2024-01-15T12:00:00Z"
  }
]
```

Metrics: `attend_latency_sec | kitchen_latency_sec | bill_latency_sec`

---

## Setup

### GET /api/setup/staff?venue_id=
### POST /api/setup/staff
Register a staff member.

**Body:**
```json
{
  "venue_id": "venue-demo-001",
  "name":     "Priya Mehta",
  "role":     "server"
}
```
`role` — one of: `server | manager | kitchen | bar`

### POST /api/setup/shifts
Create a shift for a staff member.

**Body:**
```json
{
  "venue_id":  "venue-demo-001",
  "staff_id":  "staff-srv-01",
  "starts_at": "2024-01-15T09:00:00Z",
  "ends_at":   "2024-01-15T22:00:00Z"
}
```

### POST /api/setup/zone-assignments
Assign a staff member to a zone for a shift.

**Body:**
```json
{
  "venue_id":  "venue-demo-001",
  "zone_id":   "zone-floor-a",
  "staff_id":  "staff-srv-01",
  "shift_id":  "shift-001"
}
```

### GET /api/setup/zone-assignments?venue_id=

---

## WebSocket

Connect to: `ws://localhost:3847/ws`

The server sends events whenever state changes. No authentication required for pilot.

### Messages from server → client

#### alert.created
```json
{
  "type": "alert.created",
  "payload": { ...Alert },
  "ts": "2024-01-15T14:35:00Z"
}
```

#### alert.acknowledged
```json
{
  "type": "alert.acknowledged",
  "payload": { ...Alert },
  "ts": "2024-01-15T14:36:22Z"
}
```

#### session.updated
```json
{
  "type": "session.updated",
  "payload": { ...Session },
  "ts": "2024-01-15T14:35:00Z"
}
```

#### baseline.updated
```json
{
  "type": "baseline.updated",
  "payload": { ...Baseline },
  "ts": "2024-01-15T18:00:00Z"
}
```

#### connected (on connect)
```json
{ "type": "connected", "ts": "..." }
```

### Messages from client → server

#### ping
```json
{ "type": "ping" }
```
Server responds with `{ "type": "pong", "ts": "..." }`

---

## Alert Type → Routing Matrix

| Alert Type        | Default Route | Escalation Condition         | Escalated Route |
|-------------------|--------------|------------------------------|-----------------|
| `wait_overdue`    | server       | No server on zone shift      | manager         |
| `kitchen_overdue` | kitchen      | —                            | —               |
| `bill_overdue`    | server       | 2+ prior bill alerts         | manager         |
| `call_pending`    | server       | actual > 2× expected latency | manager         |

## Severity Rules

| Severity | Condition (ratio = actual / expected) |
|----------|--------------------------------------|
| `low`    | ratio ≥ 1.10                         |
| `med`    | ratio ≥ 1.30                         |
| `high`   | ratio ≥ 1.80                         |

Trigger threshold: `actual > expected × 1.5 OR actual − expected > 180s`
