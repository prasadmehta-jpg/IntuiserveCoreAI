# SANGATI UI — Role-Based Views

> One brain, multiple faces.
> All views read from the same API. Same data, different lenses.

---

## Design Principles

1. **≤ 7 data elements per card** — no information overload
2. **1–2 taps maximum for server actions** — acknowledge = Done
3. **Manager view is calm** — zones green/yellow/red, not a wall of text
4. **Kitchen/bar show ranked lists** — most urgent always at position #1
5. **Real-time via WebSocket** — no manual refresh needed
6. **Demo mode on `/demo`** — simulator for training and testing

---

## /manager — Live Pulse Board

**Who uses it:** Manager / owner on a 10-inch tablet

### Elements (top to bottom)
1. **Page header** — title, last sync time, role switcher
2. **KPI row** (4 tiles)
   - Active sessions (green)
   - Avg attend latency today
   - Avg kitchen delay today
   - Total alerts today (red if > 10)
3. **Floor Zones** — 3 zone tiles, each showing:
   - Zone name + pulse dot (green / yellow / red)
   - Status label (Clear / Attention / Critical)
   - Active session count
   - Active alert count
4. **Active Alerts** section
   - HIGH severity alerts at top (full card with Done button)
   - MED/LOW alerts below (compact row with ✓ button)
   - "All clear" empty state when no alerts

### Update trigger
- WebSocket: `alert.created`, `alert.acknowledged`, `session.updated`
- Polling fallback: every 20 seconds

### Zone status logic
```
active_alerts = 0             → green  (Clear)
active_alerts 1–2             → yellow (Attention)
active_alerts 3+              → red    (Critical)
```

---

## /server — Action Feed

**Who uses it:** Floor server on their phone or tablet

### Elements
1. **Page header** — alert count badge
2. **Escalation banner** (if any manager-escalated alerts)
   - Shown in red, distinct from server queue
3. **Alert feed** — cards sorted by severity, then by age
   - Each card: severity badge, alert type label, message, zone, table, elapsed time
   - Large Done button (1 tap = acknowledged)
4. **All clear state** — green circle, "No pending actions"

### Key constraint
Only shows `routed_to_role = 'server'` alerts.
Manager-escalated alerts shown at top for awareness.

### Update trigger
- WebSocket + 10-second polling fallback

---

## /kitchen — Kitchen Queue

**Who uses it:** Kitchen staff on a wall-mounted screen

### Elements
1. **Page header** — overdue ticket count
2. **Numbered queue** — position badge (1, 2, 3...) on each card
   - #1 = most urgent (highest severity, then oldest)
   - Red badge for position #1
3. **Empty state** — "Kitchen On Track ✅"

### Sorting
```
1st sort: severity (high → med → low)
2nd sort: created_at ASC (oldest first within same severity)
```

### Key constraint
Only shows `routed_to_role = 'kitchen'` alerts.
`kitchen_overdue` is the primary type here.

### Update trigger
- WebSocket + 8-second polling + 1-second tick for elapsed timer

---

## /bar — Bar Queue

**Who uses it:** Bar staff

Identical layout to `/kitchen` but filters `routed_to_role = 'bar'`.

Currently: no alert type routes to 'bar' by default. Bar alerts would fire if
a `serve` event was expected from bar and didn't arrive. This is available for
future customisation (e.g. drinks-specific kitchen_overdue routing).

---

## /setup — Configuration

**Who uses it:** Manager during initial setup and when staff changes

### Tabs

#### Staff tab
- Register new staff member (name, role)
- View registered staff grouped by role
- Each staff card shows name + active indicator

#### Shifts tab
- Reference instructions for `pnpm db:seed` and direct API usage
- Link to `POST /api/setup/shifts` contract

#### Zones tab
- Reference instructions for zone assignment
- Link to `POST /api/setup/zone-assignments` contract

### Post-Pilot Enhancement
Full shift scheduling UI (drag-and-drop calendar) — deferred post-pilot.

---

## /demo — Simulator

**Who uses it:** Training, testing, demonstrations

### Elements
1. **Controls card**
   - Rush Hour toggle (Normal ↔ 🔥 Rush Hour)
   - Start Auto / Stop button
   - +1 Session button (single manual spawn)
2. **Live Stats card**
   - Sessions spawned / Events emitted / Active alerts / Active sessions
   - Running status indicator (pulsing dot)
3. **Event log** — scrolling monospace log of all events and alerts
4. **How to Test** — step-by-step instructions

### Rush Hour effect
- Service delays multiplied by 2.5×
- Attend probability of being skipped: 35% (vs 10% normal)
- Bill latency multiplied
- Kitchen latency multiplied
- Produces high volume of alerts quickly

### Auto mode
- Spawns 3–6 sessions immediately on Start
- Then spawns 1 new session every 12 seconds
- Each session emits events with realistic async delays (capped at 2s per step for demo speed)

---

## Role Switch Dropdown

Present in all views (top-right of header).

Options:
- 📊 Manager
- 🪑 Server
- 🍳 Kitchen
- 🍸 Bar
- ⚙️ Setup
- 🎮 Demo

No authentication in pilot. Role switching is instant.

---

## Responsive Behaviour

| Breakpoint | Grid layout |
|------------|-------------|
| > 768px    | 2–4 column grids |
| ≤ 768px    | 1 column (stack) |

All views are usable on a phone in portrait mode.

---

## Colour System

| Token | Value | Used for |
|-------|-------|---------|
| navy-900 | `#0B1426` | page background |
| navy-800 | `#111E35` | card background |
| navy-700 | `#172444` | input background |
| gold-400 | `#F5C842` | titles, KPI values |
| gold-500 | `#D4A017` | buttons |
| cream    | `#F5F0E8` | body text |
| green    | `#22C55E` | clear/ok states |
| yellow   | `#EAB308` | low/med severity, attention |
| orange   | `#F97316` | med severity |
| red      | `#EF4444` | high severity, critical |
