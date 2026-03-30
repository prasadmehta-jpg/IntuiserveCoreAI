interface Props {
  revenue:  number;
  target:   number;
  compact?: boolean;
}

export function RevenueBar({ revenue, target, compact = false }: Props) {
  const pct     = target > 0 ? Math.min((revenue / target) * 100, 100) : 0;
  const remain  = Math.max(target - revenue, 0);

  const color =
    pct >= 80 ? '#22C55E' :
    pct >= 60 ? '#EAB308' :
    '#EF4444';

  const label =
    pct >= 100 ? '🎯 Target hit' :
    pct >= 80  ? 'On track' :
    pct >= 60  ? 'Behind pace' :
    'Needs push';

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: 'monospace' }}>
          ₹{(revenue / 1000).toFixed(1)}K
        </span>
        <div style={{ flex: 1, height: 6, background: 'rgba(245,240,232,0.08)',
          borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, background: color,
            borderRadius: 3, transition: 'width 0.6s ease',
          }} />
        </div>
        <span style={{ fontSize: 11, color: 'rgba(245,240,232,0.4)', fontFamily: 'monospace' }}>
          {Math.round(pct)}%
        </span>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--navy-800)',
      border: `1px solid ${color}28`,
      borderRadius: 10,
      padding: '14px 20px',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontFamily: 'monospace', fontSize: 28, fontWeight: 800, color, lineHeight: 1,
          }}>
            ₹{revenue >= 100_000
              ? `${(revenue / 100_000).toFixed(1)}L`
              : `${(revenue / 1000).toFixed(1)}K`}
          </span>
          <span style={{ fontSize: 13, color: 'rgba(245,240,232,0.4)' }}>
            of ₹{target >= 100_000
              ? `${(target / 100_000).toFixed(1)}L`
              : `${(target / 1000).toFixed(0)}K`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color,
            background: `${color}18`,
            border: `1px solid ${color}30`,
            borderRadius: 99, padding: '3px 10px',
          }}>
            {label}
          </span>
          <span style={{
            fontFamily: 'monospace', fontSize: 20, fontWeight: 800,
            color: 'rgba(245,240,232,0.7)',
          }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 10, background: 'rgba(245,240,232,0.07)',
        borderRadius: 5, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 5,
          transition: 'width 0.8s ease',
          boxShadow: `0 0 8px ${color}60`,
        }} />
      </div>

      {/* Bottom row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 8, fontSize: 11,
        color: 'rgba(245,240,232,0.35)', fontFamily: 'monospace',
      }}>
        <span>Today's revenue</span>
        {remain > 0 ? (
          <span>₹{remain >= 1000
            ? `${(remain / 1000).toFixed(1)}K`
            : remain} remaining</span>
        ) : (
          <span style={{ color: '#22C55E' }}>Target exceeded ✓</span>
        )}
      </div>
    </div>
  );
}
