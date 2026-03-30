import { useState, useEffect, useCallback } from 'react';
import type { AlertWithContext } from '@sangati/shared';
import { fetchActiveAlerts } from '../lib/api';
import { useWebSocket }       from '../lib/useWebSocket';
import { AlertCard }          from '../components/AlertCard';
import { RoleSwitcher }       from '../components/RoleSwitcher';

export default function BarPage() {
  const [alerts, setAlerts] = useState<AlertWithContext[]>([]);
  const [serviceActive, setServiceActive] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchActiveAlerts('bar');
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
    const t = setInterval(refresh, 8_000);
    return () => clearInterval(t);
  }, [refresh]);

  useWebSocket({
    'alert.created':      () => refresh(),
    'alert.acknowledged': () => refresh(),
  });

  function handleStopService() {
    setServiceActive(false);
    setShowConfirm(false);
  }

  function handleStartService() {
    setServiceActive(true);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Bar Queue</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            {!serviceActive
              ? 'Bar service stopped'
              : alerts.length === 0
                ? 'No pending bar alerts'
                : `${alerts.length} alert${alerts.length > 1 ? 's' : ''}`}
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">
        {/* Service toggle */}
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          {serviceActive ? (
            <button className="btn btn-danger" onClick={() => setShowConfirm(true)}
              style={{ fontSize: 13 }}>
              Stop Service
            </button>
          ) : (
            <button className="btn btn-gold" onClick={handleStartService}
              style={{ fontSize: 13 }}>
              Resume Service
            </button>
          )}
          <span style={{
            fontSize: 12,
            color: serviceActive ? '#22C55E' : '#EF4444',
            fontWeight: 600,
          }}>
            {serviceActive ? 'Service active' : 'Service stopped'}
          </span>
        </div>

        {/* ── Confirmation Dialog ── */}
        {showConfirm && (
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
                Stop Bar Service?
              </div>
              <p style={{ fontSize: 14, color: 'rgba(245,240,232,0.65)', lineHeight: 1.6, marginBottom: 20 }}>
                This will stop accepting new bar orders. Active tickets will remain visible until completed.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => setShowConfirm(false)}
                  style={{ minWidth: 80 }}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleStopService}
                  style={{ minWidth: 80 }}>
                  Stop Service
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bar stopped banner ── */}
        {!serviceActive && (
          <div className="card" style={{
            marginBottom: 16, background: 'rgba(239,68,68,0.06)',
            borderColor: 'rgba(239,68,68,0.25)', textAlign: 'center', padding: 20,
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔴</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#EF4444' }}>Bar Service Stopped</div>
            <div style={{ fontSize: 13, color: 'rgba(245,240,232,0.5)', marginTop: 4 }}>
              Tap "Resume Service" to start accepting orders again
            </div>
          </div>
        )}

        {/* ── Alert queue ── */}
        {alerts.length === 0 && serviceActive ? (
          <div className="empty-state">
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#22C55E' }}>Bar Clear</div>
            <div style={{ marginTop: 4 }}>No pending bar tickets</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {alerts.map((a, i) => (
              <div key={a.id} style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', top: -8, left: -8,
                  background: i === 0 ? '#EF4444' : 'var(--navy-700)',
                  color: '#fff', borderRadius: 99,
                  width: 24, height: 24, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, zIndex: 1,
                }}>
                  {i + 1}
                </div>
                <AlertCard alert={a} onAcked={refresh} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
