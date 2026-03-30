import { useState, useEffect } from 'react';
import { ingestEvent, fetchActiveSessions } from '../lib/api';
import { RoleSwitcher } from '../components/RoleSwitcher';

const VENUE   = process.env.NEXT_PUBLIC_VENUE_ID ?? 'venue-demo-001';
const ZONES   = ['zone-floor-a', 'zone-floor-b', 'zone-terrace'];
const TABLES  = [
  { id: 'tbl-01', label: 'T1',  zone: 'zone-floor-a' },
  { id: 'tbl-02', label: 'T2',  zone: 'zone-floor-a' },
  { id: 'tbl-03', label: 'T3',  zone: 'zone-floor-a' },
  { id: 'tbl-04', label: 'T4',  zone: 'zone-floor-a' },
  { id: 'tbl-05', label: 'T5',  zone: 'zone-floor-b' },
  { id: 'tbl-06', label: 'T6',  zone: 'zone-floor-b' },
  { id: 'tbl-07', label: 'T7',  zone: 'zone-floor-b' },
  { id: 'tbl-08', label: 'T8',  zone: 'zone-floor-b' },
  { id: 'tbl-09', label: 'TR1', zone: 'zone-terrace'  },
  { id: 'tbl-10', label: 'TR2', zone: 'zone-terrace'  },
  { id: 'tbl-11', label: 'TR3', zone: 'zone-terrace'  },
  { id: 'tbl-12', label: 'TR4', zone: 'zone-terrace'  },
];

type EventType = 'seat' | 'attend' | 'order' | 'serve' | 'bill' | 'pay' | 'call';

const EVENTS: { type: EventType; label: string; icon: string; color: string }[] = [
  { type: 'seat',   label: 'Seated',   icon: '🪑', color: '#3B82F6' },
  { type: 'attend', label: 'Attended', icon: '👋', color: '#22C55E' },
  { type: 'order',  label: 'Ordered',  icon: '📋', color: '#F59E0B' },
  { type: 'serve',  label: 'Served',   icon: '🍽',  color: '#10B981' },
  { type: 'bill',   label: 'Bill Req', icon: '🧾', color: '#8B5CF6' },
  { type: 'pay',    label: 'Paid',     icon: '✅', color: '#6B7280' },
  { type: 'call',   label: 'Calling',  icon: '🔔', color: '#EF4444' },
];

function sessionIdForTable(tableId: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `sess-${today}-${tableId}`;
}

export default function StaffPage() {
  const [selectedTable,   setSelectedTable]   = useState<typeof TABLES[0] | null>(null);
  const [activeSessions,  setActiveSessions]  = useState<Record<string, boolean>>({});
  const [feedback,        setFeedback]        = useState<{ msg: string; ok: boolean } | null>(null);
  const [tapping,         setTapping]         = useState<EventType | null>(null);
  // Pay event: show amount input before submitting
  const [payMode,         setPayMode]         = useState(false);
  const [billAmount,      setBillAmount]       = useState('');

  useEffect(() => {
    const load = () =>
      fetchActiveSessions(VENUE)
        .then(s => {
          const m: Record<string, boolean> = {};
          for (const x of s) m[x.table_id] = true;
          setActiveSessions(m);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function tap(eventType: EventType, value?: number) {
    if (!selectedTable) return;
    setTapping(eventType);

    const sessionId = sessionIdForTable(selectedTable.id);
    try {
      await ingestEvent({
        session_id: sessionId,
        venue_id:   VENUE,
        table_id:   selectedTable.id,
        zone_id:    selectedTable.zone,
        type:       eventType,
        value,
      });
      setFeedback({
        msg: `${EVENTS.find(e => e.type === eventType)?.label} logged${value ? ` · ₹${value.toLocaleString()}` : ''}`,
        ok: true,
      });
      if (eventType === 'pay') {
        setPayMode(false);
        setBillAmount('');
        setTimeout(() => {
          fetchActiveSessions(VENUE).then(s => {
            const m: Record<string, boolean> = {};
            for (const x of s) m[x.table_id] = true;
            setActiveSessions(m);
          });
        }, 1000);
      }
    } catch {
      setFeedback({ msg: 'Error — is the API running?', ok: false });
    } finally {
      setTapping(null);
      setTimeout(() => setFeedback(null), 2500);
    }
  }

  function handlePayTap() {
    // Show amount input instead of directly posting
    setPayMode(true);
  }

  async function submitPay() {
    const amount = parseFloat(billAmount.replace(/,/g, ''));
    await tap('pay', isNaN(amount) ? undefined : amount);
  }

  const ZONES_UNIQUE = ['zone-floor-a', 'zone-floor-b', 'zone-terrace'];
  const ZONE_NAMES: Record<string, string> = {
    'zone-floor-a': 'Floor A',
    'zone-floor-b': 'Floor B',
    'zone-terrace': 'Terrace',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Event Logger</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Staff View · Tap to log
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content">

        {/* Feedback flash */}
        {feedback && (
          <div style={{
            position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)',
            background: feedback.ok ? '#22C55E' : '#EF4444',
            color: '#fff', borderRadius: 8, padding: '8px 20px',
            fontSize: 14, fontWeight: 700, zIndex: 100,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}>
            {feedback.msg}
          </div>
        )}

        {/* Step 1: Pick table */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            1. Select Table
          </div>

          {ZONES_UNIQUE.map(zone => (
            <div key={zone} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)',
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {ZONE_NAMES[zone]}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TABLES.filter(t => t.zone === zone).map(table => {
                  const isActive   = activeSessions[table.id];
                  const isSelected = selectedTable?.id === table.id;
                  return (
                    <button
                      key={table.id}
                      onClick={() => { setSelectedTable(isSelected ? null : table); setPayMode(false); }}
                      style={{
                        width: 56, height: 56, borderRadius: 10,
                        border: isSelected
                          ? '2px solid var(--gold-400)'
                          : '1px solid rgba(245,240,232,0.15)',
                        background: isSelected
                          ? 'rgba(245,200,66,0.15)'
                          : isActive ? 'rgba(34,197,94,0.1)' : 'var(--navy-800)',
                        color: isSelected ? 'var(--gold-400)'
                          : isActive ? '#22C55E' : 'rgba(245,240,232,0.7)',
                        fontWeight: 700, fontSize: 14, cursor: 'pointer',
                        position: 'relative',
                      }}
                    >
                      {table.label}
                      {isActive && (
                        <span style={{
                          position: 'absolute', top: 2, right: 2,
                          width: 6, height: 6, borderRadius: '50%', background: '#22C55E',
                        }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Step 2: Log event */}
        {selectedTable && !payMode && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              2. Log Event for{' '}
              <span style={{ color: 'var(--gold-400)' }}>{selectedTable.label}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {EVENTS.map(ev => (
                <button
                  key={ev.type}
                  className="btn"
                  onClick={() => ev.type === 'pay' ? handlePayTap() : tap(ev.type)}
                  disabled={tapping !== null}
                  style={{
                    flexDirection: 'column', gap: 6, padding: '14px 10px',
                    background: tapping === ev.type ? ev.color : `${ev.color}18`,
                    border: `1px solid ${ev.color}44`,
                    color: tapping === ev.type ? '#fff' : ev.color,
                    borderRadius: 10, height: 72,
                    opacity: tapping !== null && tapping !== ev.type ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{ev.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{ev.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pay amount modal */}
        {selectedTable && payMode && (
          <div className="card" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cream)', marginBottom: 16 }}>
              💳 Enter bill amount for{' '}
              <span style={{ color: 'var(--gold-400)' }}>{selectedTable.label}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16 }}>
              <span style={{ fontSize: 20, color: 'rgba(245,240,232,0.5)' }}>₹</span>
              <input
                type="number"
                placeholder="0"
                value={billAmount}
                onChange={e => setBillAmount(e.target.value)}
                autoFocus
                style={{ fontSize: 28, fontWeight: 800, textAlign: 'right',
                  background: 'transparent', border: 'none', color: '#22C55E',
                  outline: 'none', width: '100%', fontFamily: 'monospace' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn btn-outline"
                onClick={() => { setPayMode(false); setBillAmount(''); }}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={submitPay}
                disabled={tapping !== null}>
                {tapping === 'pay' ? '…' : 'Confirm Payment'}
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.3)', marginTop: 12, textAlign: 'center' }}>
              This closes the session and adds ₹ to today's revenue total.
              <br />Leave blank if amount is unknown.
            </div>
          </div>
        )}

        {!selectedTable && (
          <div className="empty-state" style={{ marginTop: 32 }}>
            Select a table above to log events
          </div>
        )}

      </div>
    </div>
  );
}
