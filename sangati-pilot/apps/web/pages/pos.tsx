import { useState, useEffect, useCallback } from 'react';
import { RoleSwitcher } from '../components/RoleSwitcher';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3847';

interface POSStatus {
  running:     boolean;
  orders_seen: number;
  config: {
    base_url:      string;
    restaurant_id: string;
    venue_id:      string;
    poll_interval: number;
  } | null;
}

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

export default function POSPage() {
  const [status,  setStatus]  = useState<POSStatus | null>(null);
  const [form,    setForm]    = useState({
    base_url:      'http://192.168.1.',
    api_key:       '',
    restaurant_id: '',
    venue_id:      process.env.NEXT_PUBLIC_VENUE_ID ?? 'venue-demo-001',
    poll_interval: 10000,
  });
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState('');

  const refresh = useCallback(async () => {
    try {
      const s = await apiGet('/api/pos/status') as POSStatus;
      setStatus(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function connect() {
    setSaving(true); setMsg('');
    try {
      await apiPost('/api/pos/connect', form);
      setMsg('Connected ✓');
      await refresh();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    await apiPost('/api/pos/disconnect');
    await refresh();
  }

  const isConnected = status?.running ?? false;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">🔌 POS Integration</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Petpooja · Auto-ingest orders → SANGATI events
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content" style={{ maxWidth: 600 }}>

        {/* Status card */}
        <div className="card" style={{ marginBottom: 20,
          borderColor: isConnected ? 'rgba(34,197,94,0.3)' : 'rgba(245,240,232,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span className={`pulse-dot ${isConnected ? 'green' : 'red'}`} />
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--cream)' }}>
              {isConnected ? 'POS Connected' : 'POS Disconnected'}
            </span>
          </div>

          {isConnected && status?.config && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'URL',          value: status.config.base_url },
                { label: 'Restaurant',   value: status.config.restaurant_id },
                { label: 'Poll interval',value: `${status.config.poll_interval / 1000}s` },
                { label: 'Orders seen',  value: String(status.orders_seen) },
              ].map(row => (
                <div key={row.label}>
                  <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.4)',
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                    {row.label}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--cream)', fontFamily: 'monospace' }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {isConnected && (
            <button className="btn btn-danger" onClick={disconnect} style={{ width: '100%' }}>
              Disconnect POS
            </button>
          )}
        </div>

        {/* What this does */}
        <div className="card" style={{ marginBottom: 20,
          background: 'rgba(245,200,66,0.03)', borderColor: 'rgba(245,200,66,0.12)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-400)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            How it works
          </div>
          <div style={{ fontSize: 13, color: 'rgba(245,240,232,0.6)', lineHeight: 1.9 }}>
            Once connected, SANGATI polls your Petpooja system every 10 seconds and
            auto-creates events when orders change state:
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { pos: 'Order placed',     sangati: 'order event',  color: '#F59E0B' },
              { pos: 'In kitchen',       sangati: '(tracked)',     color: '#6B7280' },
              { pos: 'Served',           sangati: 'serve event',   color: '#22C55E' },
              { pos: 'Bill generated',   sangati: 'bill event',    color: '#8B5CF6' },
              { pos: 'Payment received', sangati: 'pay event',     color: '#3B82F6' },
            ].map(row => (
              <div key={row.pos} style={{ display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 12 }}>
                <span style={{ color: 'rgba(245,240,232,0.5)', minWidth: 140 }}>{row.pos}</span>
                <span style={{ color: 'rgba(245,240,232,0.3)' }}>→</span>
                <span style={{ color: row.color, fontWeight: 600 }}>{row.sangati}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(245,240,232,0.4)' }}>
            Staff no longer need to tap events manually when POS is connected.
          </div>
        </div>

        {/* Connect form */}
        {!isConnected && (
          <div className="card">
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold-400)', marginBottom: 16 }}>
              Connect to Petpooja
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label>Petpooja Local API URL</label>
                <input value={form.base_url}
                  onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
                  placeholder="http://192.168.1.50:8080" />
                <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.3)', marginTop: 4 }}>
                  LAN IP of the machine running Petpooja (same WiFi as SANGATI laptop)
                </div>
              </div>
              <div>
                <label>API Key</label>
                <input type="password" value={form.api_key}
                  onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder="Petpooja API key" />
              </div>
              <div>
                <label>Restaurant ID</label>
                <input value={form.restaurant_id}
                  onChange={e => setForm(f => ({ ...f, restaurant_id: e.target.value }))}
                  placeholder="From Petpooja settings" />
              </div>
              <div>
                <label>Poll Interval (seconds)</label>
                <select value={form.poll_interval}
                  onChange={e => setForm(f => ({ ...f, poll_interval: Number(e.target.value) }))}>
                  <option value={5000}>5s (responsive)</option>
                  <option value={10000}>10s (default)</option>
                  <option value={30000}>30s (light)</option>
                </select>
              </div>

              {msg && (
                <div style={{ fontSize: 13,
                  color: msg.startsWith('Error') ? '#EF4444' : '#22C55E' }}>
                  {msg}
                </div>
              )}

              <button className="btn btn-gold" onClick={connect} disabled={saving ||
                !form.base_url || !form.api_key || !form.restaurant_id}>
                {saving ? 'Connecting…' : 'Connect POS'}
              </button>
            </div>
          </div>
        )}

        {/* Webhook alternative */}
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Webhook Alternative
          </div>
          <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.5)', lineHeight: 1.8 }}>
            If Petpooja is configured to push events, point its webhook URL to:
          </div>
          <code style={{ display: 'block', marginTop: 8, background: 'var(--navy-700)',
            padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--gold-400)' }}>
            POST {API}/api/pos/webhook
          </code>
        </div>

      </div>
    </div>
  );
}
