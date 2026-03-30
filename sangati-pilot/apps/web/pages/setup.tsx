import { useState, useEffect } from 'react';
import type { Staff } from '@sangati/shared';
import { fetchStaff, createStaff } from '../lib/api';
import { RoleSwitcher } from '../components/RoleSwitcher';

const VENUE = process.env.NEXT_PUBLIC_VENUE_ID ?? 'venue-demo-001';

export default function SetupPage() {
  const [staff,    setStaff]    = useState<Staff[]>([]);
  const [tab,      setTab]      = useState<'staff' | 'shifts' | 'zones'>('staff');
  const [form,     setForm]     = useState({ name: '', role: 'server' });
  const [saving,   setSaving]   = useState(false);
  const [message,  setMessage]  = useState('');

  useEffect(() => {
    fetchStaff(VENUE).then(setStaff).catch(() => {});
  }, []);

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const s = await createStaff({
        venue_id: VENUE,
        name: form.name.trim(),
        role: form.role as Staff['role'],
      });
      setStaff(prev => [...prev, s]);
      setForm(f => ({ ...f, name: '' }));
      setMessage('Staff member added ✓');
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('Error saving — is the API running?');
    } finally {
      setSaving(false);
    }
  }

  const byRole = (r: string) => staff.filter(s => s.role === r);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">⚙️  Setup</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Staff · Shifts · Zone Assignments
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {(['staff', 'shifts', 'zones'] as const).map(t => (
            <button
              key={t}
              className={`btn ${tab === t ? 'btn-gold' : 'btn-outline'}`}
              onClick={() => setTab(t)}
              style={{ textTransform: 'capitalize' }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── STAFF TAB ── */}
        {tab === 'staff' && (
          <div>
            {/* Add form */}
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--gold-400)' }}>
                Register Staff Member
              </h3>
              <form onSubmit={handleAddStaff}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
                  <div>
                    <label>Name</label>
                    <input
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Priya Sharma"
                    />
                  </div>
                  <div>
                    <label>Role</label>
                    <select
                      value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    >
                      <option value="server">Server</option>
                      <option value="manager">Manager</option>
                      <option value="kitchen">Kitchen</option>
                      <option value="bar">Bar</option>
                    </select>
                  </div>
                  <button className="btn btn-gold" type="submit" disabled={saving}>
                    {saving ? '…' : 'Add'}
                  </button>
                </div>
              </form>
              {message && (
                <div style={{ marginTop: 12, fontSize: 13, color: '#22C55E' }}>{message}</div>
              )}
            </div>

            {/* Staff list by role */}
            {['server', 'manager', 'kitchen', 'bar'].map(role => {
              const members = byRole(role);
              if (members.length === 0) return null;
              return (
                <div key={role} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.45)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    {role} ({members.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {members.map(s => (
                      <div key={s.id} className="card" style={{ padding: '8px 14px', display: 'inline-flex',
                        alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%',
                          background: '#22C55E', display: 'inline-block' }} />
                        <span style={{ fontSize: 14 }}>{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {staff.length === 0 && (
              <div className="empty-state">No staff registered yet</div>
            )}
          </div>
        )}

        {/* ── SHIFTS TAB ── */}
        {tab === 'shifts' && (
          <div className="card">
            <div style={{ color: 'rgba(245,240,232,0.5)', fontSize: 14 }}>
              <p style={{ marginBottom: 12 }}>
                Shifts define when staff are on duty. Use the API directly for full shift management,
                or use the seed script to load default shifts.
              </p>
              <code style={{ background: 'var(--navy-700)', padding: '4px 8px', borderRadius: 4,
                fontSize: 12, color: 'var(--gold-400)' }}>
                pnpm db:seed
              </code>
              <p style={{ marginTop: 12, fontSize: 13 }}>
                POST /api/setup/shifts — venue_id, staff_id, starts_at, ends_at
              </p>
            </div>
          </div>
        )}

        {/* ── ZONES TAB ── */}
        {tab === 'zones' && (
          <div className="card">
            <div style={{ color: 'rgba(245,240,232,0.5)', fontSize: 14 }}>
              <p style={{ marginBottom: 12 }}>
                Zone assignments link staff to floor zones per shift.
                Default zones are created by the seed script.
              </p>
              <code style={{ background: 'var(--navy-700)', padding: '4px 8px', borderRadius: 4,
                fontSize: 12, color: 'var(--gold-400)' }}>
                pnpm db:seed
              </code>
              <p style={{ marginTop: 12, fontSize: 13 }}>
                POST /api/setup/zone-assignments — venue_id, zone_id, staff_id, shift_id
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
