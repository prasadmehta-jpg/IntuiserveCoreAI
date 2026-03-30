import { useState, useEffect, useCallback } from 'react';
import { RoleSwitcher } from '../components/RoleSwitcher';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3847';

// ── Types ────────────────────────────────────────────────────

interface Camera {
  id:           string;
  label:        string;
  ip:           string;
  stream_url:   string;
  manufacturer?: string;
  onvif:        boolean;
  zones?:       { zone_id: string; table_id: string; bbox: number[] }[];
}

interface AgentStatus {
  camera_id: string;
  running:   boolean;
  tables:    { table_id: string; occupied: boolean }[];
}

// ── Helpers ──────────────────────────────────────────────────

async function apiGet(path: string) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
async function apiPost(path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ── Sub-tabs ─────────────────────────────────────────────────

type Tab = 'overview' | 'autonomous';

// ── Page ─────────────────────────────────────────────────────

export default function OwnerPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [cameras,  setCameras]  = useState<Camera[]>([]);
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [showStopConfirm, setShowStopConfirm] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [cams, stat] = await Promise.all([
        apiGet('/api/cameras'),
        apiGet('/api/cameras/status').catch(() => ({ agents: [] })),
      ]);
      setCameras(Array.isArray(cams) ? cams : []);
      setStatuses((stat as { agents?: AgentStatus[] }).agents ?? []);
    } catch { /* vision service may be off */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function startAgent(id: string) {
    try { await apiPost(`/api/cameras/${id}/start`); await refresh(); } catch { /* ignore */ }
  }
  async function stopAgent(id: string) {
    try { await apiPost(`/api/cameras/${id}/stop`); await refresh(); } catch { /* ignore */ }
    setShowStopConfirm(null);
  }

  function agentFor(id: string) { return statuses.find(s => s.camera_id === id); }

  const runningCount = statuses.filter(s => s.running).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Owner Dashboard</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Full control panel
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {([
            { key: 'overview' as Tab,    label: 'Overview' },
            { key: 'autonomous' as Tab,  label: 'Autonomous Operations' },
          ]).map(t => (
            <button key={t.key}
              className={`btn ${tab === t.key ? 'btn-gold' : 'btn-outline'}`}
              onClick={() => setTab(t.key)}
              style={{ fontSize: 13 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {tab === 'overview' && (
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                System Status
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--cream)' }}>
                    {cameras.length}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)' }}>Cameras</div>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: runningCount > 0 ? '#22C55E' : 'rgba(245,240,232,0.3)' }}>
                    {runningCount}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)' }}>Agents Active</div>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--gold-400)' }}>
                    {statuses.reduce((sum, s) => sum + s.tables.filter(t => t.occupied).length, 0)}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)' }}>Tables Occupied</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Quick Links
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { href: '/revenue',  label: 'Revenue & Savings Calculator' },
                  { href: '/cameras',  label: 'Camera Discovery & Setup' },
                  { href: '/setup',    label: 'Staff & Zone Configuration' },
                  { href: '/manager',  label: 'Live Operations Pulse' },
                ].map(link => (
                  <a key={link.href} href={link.href} style={{
                    display: 'block', padding: '10px 16px', borderRadius: 8,
                    background: 'var(--navy-700)', color: 'var(--cream)',
                    textDecoration: 'none', fontSize: 14,
                    border: '1px solid rgba(245,240,232,0.08)',
                  }}>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Autonomous Operations Tab ── */}
        {tab === 'autonomous' && (
          <div>
            <div className="card" style={{ marginBottom: 16, background: 'rgba(0,212,255,0.04)',
              borderColor: 'rgba(0,212,255,0.15)' }}>
              <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.5)', lineHeight: 1.8 }}>
                <strong style={{ color: '#00d4ff' }}>Autonomous Operations</strong> — AI vision agents
                monitor cameras, detect occupancy, and generate real-time signals for your staff.
              </div>
            </div>

            {cameras.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                No cameras registered yet.
                <br />
                <a href="/cameras" style={{ color: 'var(--gold-400)', marginTop: 8, display: 'inline-block' }}>
                  Go to Camera Setup to add cameras first
                </a>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cameras.map(cam => {
                  const agent   = agentFor(cam.id);
                  const running = agent?.running ?? false;
                  const occ     = agent ? agent.tables.filter(t => t.occupied).length : 0;
                  const total   = agent ? agent.tables.length : 0;
                  const hasZones = (cam.zones?.length ?? 0) > 0;

                  return (
                    <div key={cam.id} className="card" style={{
                      borderColor: running ? 'rgba(34,197,94,0.3)' : undefined,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className={`pulse-dot ${running ? 'green' : 'red'}`} />

                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cream)' }}>
                            {cam.label}
                          </div>
                          <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)', marginTop: 2 }}>
                            {cam.ip}
                            {running && total > 0 && (
                              <span style={{ marginLeft: 12 }}>{occ}/{total} occupied</span>
                            )}
                          </div>
                          {hasZones && (
                            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {cam.zones!.map((z, i) => (
                                <span key={i} style={{
                                  background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)',
                                  borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#00d4ff',
                                }}>
                                  {z.table_id} → {z.zone_id.replace('zone-', '')}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Agent controls */}
                        <div style={{ flexShrink: 0 }}>
                          {running ? (
                            <button className="btn btn-danger" style={{ fontSize: 12, padding: '6px 14px' }}
                              onClick={() => setShowStopConfirm(cam.id)}>
                              Stop Agent
                            </button>
                          ) : (
                            <button className={`btn ${hasZones ? 'btn-gold' : 'btn-outline'}`}
                              style={{ fontSize: 12, padding: '6px 14px' }}
                              onClick={() => startAgent(cam.id)}
                              disabled={!hasZones}
                              title={hasZones ? 'Start vision agent' : 'Map zones in Camera Setup first'}>
                              Start Agent
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Stop Agent Confirmation Dialog ── */}
        {showStopConfirm && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.7)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
            <div style={{
              background: 'var(--navy-800)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 12, padding: 24, maxWidth: 360, width: '100%',
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--cream)', marginBottom: 8 }}>
                Stop Vision Agent?
              </div>
              <p style={{ fontSize: 14, color: 'rgba(245,240,232,0.65)', lineHeight: 1.6, marginBottom: 20 }}>
                This will stop occupancy monitoring for this camera. You can restart it anytime.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => setShowStopConfirm(null)}
                  style={{ minWidth: 80 }}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={() => stopAgent(showStopConfirm)}
                  style={{ minWidth: 80 }}>
                  Stop Agent
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
