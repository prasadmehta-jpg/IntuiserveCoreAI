import type { ZoneHealth } from '@sangati/shared';

interface Props {
  zone: ZoneHealth;
}

const STATUS_CONFIG = {
  green:  { dot: 'green',  label: 'Clear',    bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.25)' },
  yellow: { dot: 'yellow', label: 'Attention', bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.3)'  },
  red:    { dot: 'red',    label: 'Critical',  bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.35)' },
};

export function ZoneStatus({ zone }: Props) {
  const cfg = STATUS_CONFIG[zone.status];

  return (
    <div
      style={{
        background:   cfg.bg,
        border:       `1px solid ${cfg.border}`,
        borderRadius: 10,
        padding:      16,
      }}
    >
      {/* Zone name + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className={`pulse-dot ${cfg.dot}`} />
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--cream)' }}>
          {zone.zone_name}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600,
          color: cfg.dot === 'green' ? '#22C55E' : cfg.dot === 'yellow' ? '#EAB308' : '#EF4444',
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {cfg.label}
        </span>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
        <div>
          <div style={{ color: 'rgba(245,240,232,0.45)', fontSize: 11, marginBottom: 2 }}>SESSIONS</div>
          <div style={{ color: 'var(--cream)', fontWeight: 700, fontSize: 20 }}>
            {zone.active_sessions}
          </div>
        </div>
        <div>
          <div style={{ color: 'rgba(245,240,232,0.45)', fontSize: 11, marginBottom: 2 }}>ALERTS</div>
          <div style={{
            fontWeight: 700,
            fontSize: 20,
            color: zone.active_alerts > 0
              ? (zone.active_alerts > 2 ? '#EF4444' : '#EAB308')
              : '#22C55E',
          }}>
            {zone.active_alerts}
          </div>
        </div>
      </div>
    </div>
  );
}
