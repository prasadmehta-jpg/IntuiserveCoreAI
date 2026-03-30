# SANGATI — Master Project Log

> **Single source of truth** for all SANGATI development, decisions, and documentation.
> Updated from: Claude Code (CLI), Claude Desktop, manual work, mentor feedback.

---

## Quick Status

| Area | Status | Last Updated |
|------|--------|-------------|
| Demo (Figma Make) | sangatidemo.figma.site | |
| Local Dev | C:\Users\Prasad\sangati-pilot\ | |
| Funding Stage | Pre-seed, targeting ₹75L–₹1.25Cr | |
| Next Milestone | First live café pilot | |
| Investor Pipeline | Chetan Vadia (Parekh Group), Godrej contacts | |

---

## Build Log

*Most recent first. Tag each entry with the tool used.*

### March 2026

**[2026-03-30] — Ollama install attempt**
- Tool: Claude Code
- Action: Attempted Ollama install for local LLM inference. Install did not complete — UAC popup was not approved in time.
- Files changed: None
- Notes: Retry with `winget install Ollama.Ollama` and approve the UAC popup when it appears. Ollama is needed for offline phi3:mini inference (Decision #4).

**[2026-03-30] — Camera reverse engineering + DPDPA compliance**
- Tool: Claude Code
- Action: Built `packages/camera/` discovery engine (ONVIF, SADP, RTSP scan, manufacturer fingerprinting). Expanded DB schema (cameras, nvrs, occupancy_readings, venue_config). Added DPDPA compliance routes + ConsentScreen. Updated `/cameras` page with dark-theme UI and stream health metrics. `docs/nvr-discovery.md` added as canonical reference.
- Files changed: packages/camera/src/\*, packages/db/src/schema.ts, packages/shared/src/types.ts, apps/api/src/routes/cameras.ts, apps/api/src/routes/compliance.ts, apps/web/pages/cameras.tsx, apps/web/components/ConsentScreen.tsx, docs/nvr-discovery.md
- Notes: DS-7604NI-K1 NVR not yet on network — awaiting ethernet cable. Credential vault (node-keytar) deferred to next session. Open decision: CAM-002 (confirm Hikvision sub-stream URL with real NVR).

**[2026-03-28] — Kitchen queue, Bar stop-service, Owner dashboard, Electron fixes**
- Tool: Claude Code
- Action: Built kitchen ticket queue with countdown timers (green/amber/red). Added Stop Service confirmation to Bar page. Created Owner Dashboard with Autonomous Operations tab. Fixed Electron Node.js PATH discovery, tsx.cmd execution, and API startup timeout. Moved electron-builder output to %TEMP% to avoid Windows Defender DLL locks.
- Files changed: apps/web/pages/kitchen.tsx, apps/web/pages/bar.tsx, apps/web/pages/owner.tsx, apps/web/components/RoleSwitcher.tsx, electron/main.js, PROJECT_LOG.md
- Notes: NVR (DS-7604NI-K1, Serial J25127422) needs ethernet to router before camera streams work. Bar Stop Service state is in-memory only — persisting to API is a follow-up task.

**[2026-03-28] — Session cleanup & organization**
- Tool: Claude Desktop
- Action: Consolidated old sessions, created this project log
- Notes: Claude Code and Claude Desktop are independent — this file bridges them

<!-- TEMPLATE for new entries:
**[YYYY-MM-DD] — Brief title**
- Tool: Claude Code / Claude Desktop / Manual / Claude Code + Desktop
- Action: What was done
- Files changed: list key files
- Notes: Context, blockers, follow-ups
-->

---

## Key Decisions

*Decisions that shape the product, business, or tech stack. Include rationale.*

| # | Date | Decision | Rationale | Made In |
|---|------|----------|-----------|---------|
| 1 | | Express + SQLite for backend | Lightweight, offline-first for tier 2 cities | Claude Code |
| 2 | | Zustand for state management | Simpler than Redux for pilot scope | Claude Code |
| 3 | | 8 AI agents, defined MVP build order | Focus on highest-impact agents first | Claude Desktop |
| 4 | | Ollama + phi3:mini for offline | Edge deployment in low-connectivity venues | Claude Desktop |
| 5 | | ₹75L min / ₹1.25Cr stretch capital ask | Split raise for credibility with family offices | Claude Desktop |
| 6 | | PIN auth (not passwords) for floor staff | KISS principle — restaurant staff need speed | Claude Code |
| 7 | | Camo virtual camera for venue monitoring | Low-cost, uses existing phones as cameras | Claude Code |

---

## Document Registry

*Every important document, where it lives, and its current version.*

| Document | Location | Version | Status |
|----------|----------|---------|--------|
| Master Operating Document | | V3 | Active |
| Problem Stack Framework | | | Active |
| Value Translation Layer | | | Active |
| Value Calculator | | | Active |
| Credibility Memo | | | Investor-ready |
| PoC Document | | | Investor-ready |
| Competitor Teardown Matrix | | | 8 platforms covered |
| Series Bible (BLOTHERS) | | | Complete |
| Brand Motion System | | | 4-layer protocol defined |

---

## Agent Architecture

| # | Agent | Purpose | MVP Priority |
|---|-------|---------|-------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | | | |

*Fill in from your Agent Dashboard specs.*

---

## Mentor Feedback Log

| Date | From | Key Feedback | Action Taken |
|------|------|-------------|-------------|
| | Mr. Girish Bapat | | |

---

## Investor Outreach Tracker

| Contact | Organization | Status | Next Step | Last Touch |
|---------|-------------|--------|-----------|-----------|
| Chetan Vadia | Parekh Group Family Office | Warm | | |
| | Godrej board | Research | | |

---

## Side Projects

### SathiAI (Voice AI for Elder Care)
- Status:
- Last activity:

### BLOTHERS (Animated Series)
- Status: Series Bible complete, 60 episodes / 5 seasons planned
- Last activity:

### Date Pit Powder
- Status:
- Last activity:

---

## Monthly Retrospective

### March 2026
- **Built:** Kitchen ticket queue, Bar stop-service confirmation, Owner Dashboard + Autonomous Operations tab, camera discovery engine (ONVIF/SADP/RTSP), DPDPA compliance routes, ConsentScreen, NVR channel URL builders for 6 brands
- **Decided:** Offline-first SQLite (node:sqlite, no native deps), credential vault via OS keychain (not DB), DPDPA consent gate before first use, electron-builder output to %TEMP% to bypass Defender locks
- **Blocked:** DS-7604NI-K1 NVR not on LAN — needs ethernet cable before any camera stream testing
- **Next month focus:** Live camera pilot — connect NVR, verify RTSP sub-stream URLs, test YOLO occupancy detection end-to-end

---

*End of log. Keep this file updated after every working session.*
