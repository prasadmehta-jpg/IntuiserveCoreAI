import { useState, useRef, useEffect } from 'react';
import { ingestEvent, fetchActiveAlerts, fetchActiveSessions } from '../lib/api';
import { RoleSwitcher } from '../components/RoleSwitcher';
import { v4 as uuid } from 'uuid';
import type { AlertWithContext } from '@sangati/shared';

const VENUE   = process.env.NEXT_PUBLIC_VENUE_ID ?? 'venue-demo-001';
const ZONES   = ['zone-floor-a', 'zone-floor-b', 'zone-terrace'];
const TABLES  = Array.from({ length: 12 }, (_, i) => `tbl-${String(i + 1).padStart(2, '0')}`);

interface SimState {
  running:   boolean;
  rushHour:  boolean;
  sessions:  number;
  events:    number;
  alerts:    number;
  log:       string[];
}

type EventType = 'seat' | 'attend' | 'order' | 'serve' | 'bill' | 'pay' | 'call';

/** Generate realistic event delays. rushHour = multiply delays */
function makeSession(rushHour: boolean) {
  const tableIdx = Math.floor(Math.random() * TABLES.length);
  const zoneIdx  = Math.floor(Math.random() * ZONES.length);
  const mult     = rushHour ? 2.2 : 1.0;

  const sessionId = uuid();
  const tableId   = TABLES[tableIdx];
  const zoneId    = ZONES[zoneIdx];

  const events: { type: EventType; delayMs: number }[] = [
    { type: 'seat',   delayMs: 0 },
    { type: 'attend', delayMs: (180 + Math.random() * 360)  * mult * 1000 },
    { type: 'order',  delayMs: (120 + Math.random() * 180)  * 1000 },
    { type: 'serve',  delayMs: (600 + Math.random() * 600)  * mult * 1000 },
    { type: 'bill',   delayMs: (300 + Math.random() * 300)  * 1000 },
    { type: 'pay',    delayMs: (120 + Math.random() * 360)  * mult * 1000 },
  ];

  // Occasionally drop an attend (creates wait_overdue)
  if (Math.random() < (rushHour ? 0.4 : 0.15)) {
    const idx = events.findIndex(e => e.type === 'attend');
    if (idx !== -1) events.splice(idx, 1);
  }

  // Occasionally add a call event
  if (Math.random() < 0.2) {
    events.splice(2, 0, { type: 'call', delayMs: 60_000 });
  }

  return { sessionId, tableId, zoneId, events };
}

export default function DemoPage() {
  const [state, setState] = useState<SimState>({
    running: false, rushHour: false,
    sessions: 0, events: 0, alerts: 0, log: [],
  });
  const [activeAlerts, setActiveAlerts] = useState<AlertWithContext[]>([]);
  const [activeSessions, setActiveSessions] = useState(0);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state.log]);

  // Poll stats while running
  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(async () => {
      const [alerts, sessions] = await Promise.all([
        fetchActiveAlerts().catch(() => [] as AlertWithContext[]),
        fetchActiveSessions(VENUE).catch(() => []),
      ]);
      setActiveAlerts(alerts);
      setActiveSessions(sessions.length);
      setState(s => ({ ...s, alerts: alerts.length }));
    }, 3000);
    return () => clearInterval(t);
  }, [state.running]);

  function addLog(msg: string) {
    setState(s => ({ ...s, log: [...s.log.slice(-60), msg] }));
  }

  async function spawnSession(rushHour: boolean) {
    const { sessionId, tableId, zoneId, events } = makeSession(rushHour);
    let cumulative = 0;

    addLog(`▶ Session ${sessionId.slice(0, 8)} → ${tableId} (${zoneId})`);

    for (const ev of events) {
      cumulative += ev.delayMs;
      const t = setTimeout(async () => {
        try {
          const result = await ingestEvent({
            session_id: sessionId,
            venue_id:   VENUE,
            table_id:   tableId,
            zone_id:    zoneId,
            type:       ev.type,
          });
          setState(s => ({ ...s, events: s.events + 1 }));
          if ((result as { new_alerts?: number }).new_alerts) {
            addLog(`  🔔 [${ev.type}] → ${(result as { new_alerts?: number }).new_alerts} alert(s)`);
          } else {
            addLog(`  ✓ [${ev.type}]`);
          }
        } catch {
          addLog(`  ✗ [${ev.type}] — API error`);
        }
      }, cumulative);
      timerRefs.current.push(t);
    }

    setState(s => ({ ...s, sessions: s.sessions + 1 }));
  }

  function startSim() {
    const rushHour = state.rushHour;
    setState(s => ({ ...s, running: true, log: ['Simulator started…'] }));

    // Spawn first batch immediately
    const initialCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < initialCount; i++) {
      setTimeout(() => spawnSession(rushHour), i * 2000);
    }

    // Continue spawning new sessions
    intervalRef.current = setInterval(() => {
      if (Math.random() < 0.6) spawnSession(rushHour);
    }, 12_000);
  }

  function stopSim() {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setState(s => ({ ...s, running: false }));
    addLog('— Simulator stopped —');
  }

  function spawnOne() {
    spawnSession(state.rushHour);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">🎮 Demo Simulator</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Generates realistic sessions + events to trigger the deviation engine
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

          {/* Controls */}
          <div className="card">
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold-400)', marginBottom: 16 }}>
              Controls
            </h3>

            {/* Rush hour toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <button
                className={`btn ${state.rushHour ? 'btn-danger' : 'btn-outline'}`}
                onClick={() => setState(s => ({ ...s, rushHour: !s.rushHour }))}
                style={{ flex: 1 }}
              >
                {state.rushHour ? '🔥 Rush Hour ON' : '🕐 Normal Pace'}
              </button>
            </div>

            {/* Start / Stop */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className={`btn ${state.running ? 'btn-danger' : 'btn-gold'}`}
                style={{ flex: 1 }}
                onClick={() => state.running ? stopSim() : startSim()}
              >
                {state.running ? '⏹ Stop' : '▶ Start Auto'}
              </button>
              <button
                className="btn btn-outline"
                onClick={spawnOne}
                disabled={state.running}
              >
                +1 Session
              </button>
            </div>

            <div style={{ marginTop: 16, fontSize: 12, color: 'rgba(245,240,232,0.4)' }}>
              Rush Hour multiplies all service delays by 2.2×, triggering more deviations.
            </div>
          </div>

          {/* Live Stats */}
          <div className="card">
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold-400)', marginBottom: 16 }}>
              Live Stats
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[
                { label: 'Sessions Spawned', value: state.sessions },
                { label: 'Events Emitted',   value: state.events   },
                { label: 'Active Alerts',     value: state.alerts,  color: state.alerts > 0 ? '#EF4444' : '#22C55E' },
                { label: 'Active Sessions',   value: activeSessions },
              ].map(stat => (
                <div key={stat.label}>
                  <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.4)',
                    textTransform: 'uppercase', marginBottom: 4 }}>{stat.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800,
                    color: stat.color ?? 'var(--gold-400)' }}>{stat.value}</div>
                </div>
              ))}
            </div>

            {/* Running indicator */}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`pulse-dot ${state.running ? 'green' : 'red'}`} />
              <span style={{ fontSize: 12, color: 'rgba(245,240,232,0.5)' }}>
                {state.running ? 'Simulator running' : 'Simulator stopped'}
              </span>
            </div>
          </div>
        </div>

        {/* Event log */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold-400)' }}>Event Log</h3>
            <button
              className="btn btn-outline"
              style={{ padding: '3px 10px', fontSize: 11 }}
              onClick={() => setState(s => ({ ...s, log: [] }))}
            >
              Clear
            </button>
          </div>
          <div
            ref={logRef}
            style={{
              fontFamily: 'monospace', fontSize: 12,
              color: 'rgba(245,240,232,0.7)',
              background: 'var(--navy-900)',
              borderRadius: 6, padding: 12,
              height: 280, overflowY: 'auto',
              lineHeight: 1.6,
            }}
          >
            {state.log.length === 0
              ? <span style={{ color: 'rgba(245,240,232,0.3)' }}>Press Start to begin simulation…</span>
              : state.log.map((line, i) => <div key={i}>{line}</div>)
            }
          </div>
        </div>

        {/* Instructions */}
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold-400)', marginBottom: 10 }}>
            How to Test
          </h3>
          <ol style={{ fontSize: 13, color: 'rgba(245,240,232,0.6)', lineHeight: 2, paddingLeft: 20 }}>
            <li>Click <strong style={{ color: 'var(--cream)' }}>Start Auto</strong> — sessions begin spawning</li>
            <li>Switch to <strong style={{ color: 'var(--cream)' }}>Manager</strong> view to see zone health + KPIs</li>
            <li>Switch to <strong style={{ color: 'var(--cream)' }}>Server</strong> view to see and acknowledge alerts</li>
            <li>Enable <strong style={{ color: '#EF4444' }}>Rush Hour</strong> — delays multiply, alerts escalate</li>
            <li>Click <strong style={{ color: 'var(--cream)' }}>Kitchen</strong> — see prioritized overdue queue</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
