# SANGATI Pilot Playbook

> First real-venue deployment guide.
> **Goal of Pilot:** Validate deviation detection accuracy, alert routing, and staff adoption
> before scaling to multi-venue.

---

## Pre-Pilot Checklist (Day 0)

### Hardware
- [ ] Laptop with Windows 10/11, Node.js 18+, pnpm installed
- [ ] Minimum 8GB RAM, SSD recommended
- [ ] Stable local WiFi (or ethernet) — all traffic stays on-premises
- [ ] 10-inch tablet for manager view (Chrome, connect to `http://[laptop-ip]:3000/manager`)
- [ ] Staff phones or tablets for server/kitchen/bar views

### Software Setup
```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm golden          # must PASS before pilot
pnpm dev             # leave running
```

### Network
- Find laptop IP: `ipconfig` → IPv4 address (e.g. 192.168.1.42)
- All devices connect to `http://192.168.1.42:3000`
- API on `http://192.168.1.42:3847`

### Staff Registration
Open `http://[ip]:3000/setup` → register each staff member with correct role.
Then run `pnpm db:seed` which also creates default shifts covering today.

---

## Day 1–30: Rules-Only Phase

**What's active:** Pure threshold-based deviation detection using default baselines.
**What's learning:** Nothing yet. All baselines = defaults.

### Default Baselines
| Metric | Expected | Trigger At |
|--------|----------|------------|
| Attend latency (seat → staff) | 5 min (300s) | >7.5 min |
| Kitchen delay (order → serve) | 15 min (900s) | >22.5 min |
| Bill latency (bill → pay) | 4 min (240s) | >6 min |

### Daily Operations
1. Open `pnpm dev` on the laptop before service
2. Staff open their role view on their device (bookmark it)
3. When a table is seated, log a `seat` event via the API or demo page
4. Monitor `/manager` for zone health

### What to Watch
- Are alerts firing at the right moments?
- Are staff acknowledging within a reasonable time?
- Are there false positives? (alerts that fired but service was actually fine)

### Adjustments in Day 1–30
If default baselines are wrong for this venue, manually update via SQL:
```sql
UPDATE baselines SET expected_value = 420 WHERE metric = 'attend_latency_sec';
```
Then restart API. Note the correct values in DECISIONS_NEEDED.md for the next phase.

---

## Day 31: Enable Learning

Set in `.env`:
```
ENABLE_MODEL_TRAINING=true
```
Restart API. Now: after every session closes, rolling baseline recomputation is active
and has accumulated 30+ sessions of real data to work from.

Baseline learning requires minimum 5 closed sessions per zone before it overrides defaults.

---

## Day 61: Baseline Intelligence Active

By this point:
- 30+ sessions per zone have been processed
- Baselines reflect actual venue rhythm (not just defaults)
- Deviation engine is calibrated to THIS restaurant's pace

Watch for:
- `baseline.updated` WebSocket events (visible in browser console)
- KPIs page: avg_attend_latency_sec should match what staff observe

---

## Day 90+: Post-Pilot Review Meeting

Bring to the review:
1. Export `session_features` table — compute percentile distributions
2. Export `alerts` table — calculate ack latency trend over 90 days
3. Export `baselines` — compare final vs default values
4. Note any zone differences (terrace typically slower than indoor)

```sql
-- Average ack latency by week
SELECT strftime('%W', created_at) as week,
       AVG((julianday(acknowledged_at) - julianday(created_at)) * 86400) as avg_ack_sec
FROM alerts
WHERE acknowledged_at IS NOT NULL
GROUP BY week ORDER BY week;

-- Alert volume by type
SELECT type, severity, COUNT(*) as n
FROM alerts
GROUP BY type, severity ORDER BY n DESC;

-- Baseline drift: default vs learned
SELECT metric,
       300 as default_val,  -- replace with actual defaults per metric
       expected_value as learned_val,
       ROUND((expected_value - 300.0) / 300.0 * 100, 1) as pct_change
FROM baselines
WHERE venue_id = 'venue-demo-001';
```

---

## Staff Training Script (5 minutes)

### For Servers
> "You'll get alerts on your phone when a table needs attention.
> Tap Done when you've handled it. That's all you need to do."

- Show the server page at `/server`
- Demo: show an alert appearing, tap Done
- Explain: the system watches timing so you don't have to remember every table

### For Kitchen
> "Your screen shows which orders are running late, ranked by how overdue they are.
> Number 1 at the top is the most urgent."

- Show `/kitchen`
- Explain: alerts auto-clear when food is served (via serve event)

### For Manager
> "This board shows the health of each zone. Green = fine.
> Yellow/red = something needs attention. You'll also get escalation alerts
> when a server hasn't responded."

- Show `/manager`
- Walk through KPIs: attend latency, kitchen delay, alerts per hour

---

## Failure Modes and Recovery

### API not responding
```bash
# Check if running
curl http://localhost:3847/health

# Restart
pnpm dev
```

### Database corruption
```bash
# Backup first
cp data/sangati.db data/sangati.backup.$(date +%Y%m%d).db

# Check integrity
sqlite3 data/sangati.db "PRAGMA integrity_check;"
```

### High false-positive alert rate
Likely cause: default baselines don't match venue pace.

Immediate fix (SQL):
```sql
-- Slow down attend expectation for a busy venue
UPDATE baselines SET expected_value = 480
WHERE metric = 'attend_latency_sec';
```
Long-term fix: wait for Day 31 learning to kick in.

### Laptop restart during service
- Data is safe in SQLite (WAL mode, no transactions lost)
- Active sessions will resume on restart
- Timer-based alerts will re-evaluate within 15 seconds of API starting

### No staff on zone (alerts going to manager instead of server)
Check zone assignments:
```sql
SELECT za.zone_id, s.name, s.role, sh.starts_at, sh.ends_at
FROM zone_assignments za
JOIN staff s ON s.id = za.staff_id
JOIN shifts sh ON sh.id = za.shift_id
WHERE sh.starts_at <= datetime('now') AND sh.ends_at >= datetime('now');
```
If empty: run `pnpm db:seed` to recreate today's default shift assignments.

---

## Success Criteria

Pilot is successful if after 30 days:

| Metric | Target |
|--------|--------|
| Avg alert ack latency | < 3 minutes |
| False positive rate | < 20% (staff say alert was unnecessary) |
| Staff adoption | > 80% of alerts acknowledged within 5 min |
| Sessions with undetected issues | < 10% |
| Uptime | > 95% of service hours |

---

## Contacts and Escalation

- Technical issues → Prasad (SANGATI founder)
- Venue configuration → Update `/setup` page
- Feature requests → Document in DECISIONS_NEEDED.md for post-pilot roadmap
