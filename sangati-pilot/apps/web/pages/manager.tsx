import { useState, useEffect, useCallback } from 'react';
import type { KPIs, AlertWithContext, ZoneHealth } from '@sangati/shared';
import {
  fetchKPIs, fetchActiveSessions, fetchActiveAlerts,
  deriveZoneHealth, closeSession,
} from '../lib/api';
import { useWebSocket }   from '../lib/useWebSocket';
import { KPICard }        from '../components/KPICard';
import { ZoneStatus }     from '../components/ZoneStatus';
import { AlertCard }      from '../components/AlertCard';
import { RoleSwitcher }   from '../components/RoleSwitcher';
import { RevenueBar }     from '../components/RevenueBar';

const VENUE   = process.env.NEXT_PUBLIC_VENUE_ID ?? 'venue-demo-001';
const POLL_MS = 20_000;

function fmtSec(sec: number): string {
  if (sec === 0) return '—';
  if (sec < 60)  return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function fmtAge(isoTs: string): string {
  const sec = Math.floor((Date.now() - new Date(isoTs).getTime()) / 1000);
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

type KPIsWithRevenue = KPIs & { today_revenue: number; daily_target: number };

interface ActiveSession {
  id: string; table_id: string; zone_name: string;
  started_at: string; active_alerts: number;
  highest_severity: 'low' | 'med' | 'high' | null;
  last_event_type: string | null; event_count: number;
}

export default function ManagerPage() {
  const [kpis,     setKpis]     = useState<KPIsWithRevenue | null>(null);
  const [zones,    setZones]    = useState<ZoneHealth[]>([]);
  const [alerts,   setAlerts]   = useState<AlertWithContext[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [closing,  setClosing]  = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [k, sess, a] = await Promise.all([
        fetchKPIs(VENUE),
        fetchActiveSessions(VENUE),
        fetchActiveAlerts(),
      ]);
      setKpis(k as KPIsWithRevenue);
      setSessions(sess as unknown as ActiveSession[]);
      setZones(deriveZoneHealth(sess, {}));
      setAlerts(a);
      setLastSync(new Date());
    } catch { /* API not up yet */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useWebSocket({
    'alert.created':      () => refresh(),
    'alert.acknowledged': () => refresh(),
    'session.updated':    () => refresh(),
    'baseline.updated':   () => refresh(),
  });

  async function handleClose(sessionId: string) {
    setClosing(sessionId);
    try { await closeSession(sessionId); refresh(); }
    catch { /* ignore */ }
    finally { setClosing(null); }
  }

  const highAlerts  = alerts.filter(a => a.severity === 'high');
  const otherAlerts = alerts.filter(a => a.severity !== 'high');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">SANGATI — Live Pulse</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Manager View{lastSync ? ` · Synced ${lastSync.toLocaleTimeString()}` : ''}
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">

        {/* ── REVENUE BAR — top of everything ── */}
        {kpis && (
          <div style={{ marginBottom: 20 }}>
            <RevenueBar
              revenue={kpis.today_revenue}
              target={kpis.daily_target}
            />
          </div>
        )}

        {/* KPI Row */}
        {kpis && (
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <KPICard icon="🪑" label="Active Sessions"
              value={kpis.active_sessions} color="#22C55E" />
            <KPICard icon="⏱" label="Avg Attend Latency"
              value={fmtSec(kpis.avg_attend_latency_sec)} sub="seat → staff arrives" />
            <KPICard icon="🍳" label="Avg Kitchen Delay"
              value={fmtSec(kpis.avg_kitchen_delay_sec)} sub="order → food served" />
            <KPICard icon="🔔" label="Alerts Today"
              value={kpis.total_alerts_today}
              color={kpis.total_alerts_today > 10 ? '#EF4444' : 'var(--gold-400)'}
              sub={`${kpis.alerts_per_hour}/hr · ${kpis.sessions_with_multiple_alerts_pct}% multi-alert`}
            />
          </div>
        )}

        {/* Zone Health */}
        {zones.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Floor Zones
            </h2>
            <div className="grid-3">
              {zones.map(z => <ZoneStatus key={z.zone_id} zone={z} />)}
            </div>
          </div>
        )}

        {/* Active Sessions */}
        {sessions.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Active Sessions ({sessions.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map(s => (
                <div key={s.id} className="card" style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  borderColor: s.highest_severity === 'high' ? 'rgba(239,68,68,0.4)'
                    : s.highest_severity === 'med' ? 'rgba(249,115,22,0.3)' : undefined,
                }}>
                  <div style={{ minWidth: 48 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--gold-400)' }}>
                      {s.table_id.replace('tbl-', 'T')}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(245,240,232,0.4)' }}>{s.zone_name}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.6)' }}>
                      Open {fmtAge(s.started_at)} · {s.event_count} events
                      {s.last_event_type && ` · Last: ${s.last_event_type}`}
                    </div>
                  </div>
                  {s.active_alerts > 0 && (
                    <span style={{
                      background: s.highest_severity === 'high' ? '#EF4444'
                        : s.highest_severity === 'med' ? '#F97316' : '#EAB308',
                      color: '#fff', borderRadius: 99, padding: '2px 8px',
                      fontSize: 11, fontWeight: 700,
                    }}>
                      {s.active_alerts} alert{s.active_alerts > 1 ? 's' : ''}
                    </span>
                  )}
                  <button className="btn btn-outline"
                    style={{ padding: '4px 12px', fontSize: 12, flexShrink: 0 }}
                    onClick={() => handleClose(s.id)}
                    disabled={closing === s.id}>
                    {closing === s.id ? '…' : 'Close'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Alerts */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
              textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Active Alerts
              {alerts.length > 0 && (
                <span style={{ marginLeft: 8, background: '#EF4444', color: '#fff',
                  borderRadius: 99, padding: '1px 7px', fontSize: 11 }}>
                  {alerts.length}
                </span>
              )}
            </h2>
            {kpis && (
              <span style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)' }}>
                Avg ack: {fmtSec(kpis.avg_ack_latency_sec)}
              </span>
            )}
          </div>

          {alerts.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              All clear — no active alerts
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {highAlerts.map(a  => <AlertCard key={a.id} alert={a} onAcked={refresh} />)}
              {otherAlerts.map(a => <AlertCard key={a.id} alert={a} onAcked={refresh} compact />)}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
