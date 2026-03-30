interface Props {
  label:    string;
  value:    string | number;
  unit?:    string;
  sub?:     string;
  color?:   string;
  icon?:    string;
}

export function KPICard({ label, value, unit, sub, color = 'var(--gold-400)', icon }: Props) {
  return (
    <div className="card" style={{ minHeight: 90 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(245,240,232,0.45)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {icon && <span style={{ marginRight: 5 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 13, color: 'rgba(245,240,232,0.5)' }}>{unit}</span>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
