import { useState } from 'react';
import { ackAlert } from '../lib/api';
import type { AlertWithContext } from '@sangati/shared';
import { ALERT_TYPE_LABELS } from '@sangati/shared';
import { SEVERITY_LABEL, ROUTED_TO_LABEL, ACK_LABEL, label } from '../lib/labels';

function elapsed(isoTs: string): string {
  const sec = Math.floor((Date.now() - new Date(isoTs).getTime()) / 1000);
  if (sec < 60)  return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

interface Props {
  alert: AlertWithContext;
  staffId?: string;
  onAcked?: () => void;
  compact?: boolean;
}

export function AlertCard({ alert, staffId = 'staff-demo', onAcked, compact }: Props) {
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(!!alert.acknowledged_at);

  const sevClass = `badge badge-${alert.severity}`;

  async function handleAck() {
    setLoading(true);
    try {
      await ackAlert(alert.id, staffId);
      setDone(true);
      onAcked?.();
    } catch {
      /* show nothing — optimistic */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        opacity:       done ? 0.45 : 1,
        borderColor:   done ? 'transparent'
          : alert.severity === 'high' ? 'rgba(239,68,68,0.5)'
          : alert.severity === 'med'  ? 'rgba(249,115,22,0.4)'
          : 'rgba(234,179,8,0.25)',
        transition:    'opacity 0.3s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1 }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className={sevClass}>
              {label(SEVERITY_LABEL, alert.severity)}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cream)' }}>
              {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
            </span>
            {done && (
              <span className="badge badge-green">{ACK_LABEL}</span>
            )}
          </div>

          {/* Message */}
          <p style={{ fontSize: 14, color: 'rgba(245,240,232,0.85)', marginBottom: compact ? 4 : 8 }}>
            {alert.message}
          </p>

          {/* Context */}
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'rgba(245,240,232,0.45)' }}>
            {alert.zone_name && <span>📍 {alert.zone_name}</span>}
            {alert.table_label && <span>🪑 {alert.table_label}</span>}
            <span>🕐 {elapsed(alert.created_at)}</span>
            <span>{label(ROUTED_TO_LABEL, alert.routed_to_role)}</span>
          </div>
        </div>

        {/* Ack button */}
        {!done && !compact && (
          <button
            className="btn btn-gold"
            onClick={handleAck}
            disabled={loading}
            style={{ flexShrink: 0, minWidth: 64 }}
          >
            {loading ? '…' : 'Done'}
          </button>
        )}
        {!done && compact && (
          <button
            className="btn btn-outline"
            onClick={handleAck}
            disabled={loading}
            style={{ flexShrink: 0, padding: '4px 10px', fontSize: 12 }}
          >
            ✓
          </button>
        )}
      </div>
    </div>
  );
}
