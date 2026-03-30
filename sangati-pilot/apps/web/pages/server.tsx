import { useState, useEffect, useCallback } from 'react';
import type { AlertWithContext } from '@sangati/shared';
import { fetchActiveAlerts } from '../lib/api';
import { useWebSocket }       from '../lib/useWebSocket';
import { AlertCard }          from '../components/AlertCard';
import { RoleSwitcher }       from '../components/RoleSwitcher';

export default function ServerPage() {
  const [alerts,  setAlerts]  = useState<AlertWithContext[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchActiveAlerts('server');
      setAlerts(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  useWebSocket({
    'alert.created':      () => refresh(),
    'alert.acknowledged': () => refresh(),
  });

  const managerAlerts = alerts.filter(a => a.routed_to_role === 'manager');
  const serverAlerts  = alerts.filter(a => a.routed_to_role === 'server');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Action Feed</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Server View · {alerts.length} pending
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">

        {/* Manager escalations shown at top */}
        {managerAlerts.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              ⚠ Escalated — Manager Required
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {managerAlerts.map(a => (
                <AlertCard key={a.id} alert={a} onAcked={refresh} />
              ))}
            </div>
          </div>
        )}

        {/* Server queue */}
        <div>
          {alerts.length === 0 && !loading ? (
            <div className="empty-state">
              <div style={{ fontSize: 40, marginBottom: 8 }}>🟢</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#22C55E', marginBottom: 4 }}>
                All Clear
              </div>
              <div>No pending actions right now</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {serverAlerts.map(a => (
                <AlertCard key={a.id} alert={a} onAcked={refresh} />
              ))}
            </div>
          )}
        </div>

        {/* Tap hint */}
        {alerts.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12,
            color: 'rgba(245,240,232,0.3)' }}>
            Tap Done to acknowledge an alert
          </div>
        )}
      </div>
    </div>
  );
}
