import { useState, useEffect, useCallback } from 'react';
import type { AlertWithContext } from '@sangati/shared';
import { fetchActiveAlerts } from '../lib/api';
import { useWebSocket }       from '../lib/useWebSocket';
import { AlertCard }          from '../components/AlertCard';
import { RoleSwitcher }       from '../components/RoleSwitcher';

/** Minutes elapsed since an ISO timestamp */
function elapsedMin(isoTs: string): number {
  return (Date.now() - new Date(isoTs).getTime()) / 60_000;
}

/** Human-readable countdown string */
function fmtElapsed(isoTs: string): string {
  const sec = Math.floor((Date.now() - new Date(isoTs).getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Timer color: Green <8min, Amber 8–14min, Red 15+min */
function timerColor(isoTs: string): string {
  const m = elapsedMin(isoTs);
  if (m < 8)  return '#22C55E'; // green
  if (m < 15) return '#F59E0B'; // amber
  return '#EF4444';              // red
}

export default function KitchenPage() {
  const [alerts,  setAlerts]  = useState<AlertWithContext[]>([]);
  const [_tick,   setTick]    = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchActiveAlerts('kitchen');
      data.sort((a, b) => {
        const sevOrder: Record<string, number> = { high: 0, med: 1, low: 2 };
        const ds = (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
        if (ds !== 0) return ds;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      setAlerts(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const t  = setInterval(refresh, 8_000);
    const t2 = setInterval(() => setTick(n => n + 1), 1000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, [refresh]);

  useWebSocket({
    'alert.created':      () => refresh(),
    'alert.acknowledged': () => refresh(),
  });

  // Top 3 active tickets for the prominent display
  const topTickets = alerts.slice(0, 3);
  const remaining  = alerts.slice(3);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Kitchen Queue</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            {alerts.length === 0 ? 'No active tickets' : `${alerts.length} active ticket${alerts.length > 1 ? 's' : ''}`}
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">
        {alerts.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#22C55E' }}>Kitchen On Track</div>
            <div style={{ marginTop: 4 }}>No active tickets</div>
          </div>
        ) : (
          <>
            {/* ── Top 3 Ticket Cards with Countdown Timers ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: remaining.length > 0 ? 24 : 0 }}>
              {topTickets.map((a, i) => {
                const color = timerColor(a.created_at);
                return (
                  <div key={a.id} className="card" style={{
                    borderColor: color === '#EF4444' ? 'rgba(239,68,68,0.5)'
                               : color === '#F59E0B' ? 'rgba(245,158,11,0.4)'
                               : 'rgba(34,197,94,0.3)',
                    padding: 16,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      {/* Queue position */}
                      <div style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: i === 0 ? 'rgba(239,68,68,0.15)' : 'var(--navy-700)',
                        border: `2px solid ${i === 0 ? '#EF4444' : 'rgba(245,240,232,0.1)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, fontWeight: 900, color: i === 0 ? '#EF4444' : 'rgba(245,240,232,0.5)',
                        flexShrink: 0,
                      }}>
                        #{i + 1}
                      </div>

                      {/* Ticket info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cream)', marginBottom: 4 }}>
                          {a.message}
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'rgba(245,240,232,0.45)' }}>
                          {a.table_label && <span>{a.table_label}</span>}
                          {a.zone_name && <span>{a.zone_name}</span>}
                        </div>
                      </div>

                      {/* Countdown timer */}
                      <div style={{
                        textAlign: 'center', flexShrink: 0, minWidth: 64,
                      }}>
                        <div style={{
                          fontSize: 28, fontWeight: 900, fontFamily: 'monospace',
                          color, lineHeight: 1,
                        }}>
                          {fmtElapsed(a.created_at)}
                        </div>
                        <div style={{
                          fontSize: 10, color: 'rgba(245,240,232,0.35)',
                          textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4,
                        }}>
                          elapsed
                        </div>
                      </div>

                      {/* Done button */}
                      <AlertCard alert={a} onAcked={refresh} compact />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Remaining tickets (compact list) ── */}
            {remaining.length > 0 && (
              <>
                <div style={{
                  fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.4)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
                }}>
                  {remaining.length} more ticket{remaining.length > 1 ? 's' : ''}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {remaining.map((a, i) => (
                    <div key={a.id} className="card" style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 800, color: 'rgba(245,240,232,0.3)',
                          minWidth: 24, textAlign: 'center',
                        }}>
                          #{i + 4}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, color: 'rgba(245,240,232,0.7)' }}>
                          {a.message}
                        </span>
                        <span style={{
                          fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
                          color: timerColor(a.created_at),
                        }}>
                          {fmtElapsed(a.created_at)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
