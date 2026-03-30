import { useState, useEffect, useCallback } from 'react';
import { RoleSwitcher } from '../components/RoleSwitcher';
import { RevenueBar }   from '../components/RevenueBar';
import { fetchKPIs }    from '../lib/api';

const VENUE = process.env.NEXT_PUBLIC_VENUE_ID ?? 'venue-demo-001';

// ── Savings Calculator ────────────────────────────────────────

const PLANS = [
  { name: 'Micro',         monthly: 1999,  color: '#6B7280' },
  { name: 'Casual Dining', monthly: 3999,  color: '#F59E0B' },
  { name: 'Full Service',  monthly: 6999,  color: '#3B82F6' },
  { name: 'Multi-Outlet',  monthly: 12999, color: '#8B5CF6' },
  { name: 'Chain',         monthly: 24999, color: '#EC4899' },
];

const QUESTIONS = [
  {
    id: 'revenue', label: 'Monthly Revenue',
    sub: 'All sales — dine-in, delivery, takeaway',
    options: [
      { label: 'Under ₹3L',   value: 250_000   },
      { label: '₹3L – ₹6L',  value: 450_000   },
      { label: '₹6L – ₹12L', value: 900_000   },
      { label: '₹12L – ₹25L',value: 1_850_000 },
      { label: 'Above ₹25L', value: 3_000_000 },
    ],
  },
  {
    id: 'rawmaterial', label: 'Monthly Raw Material Spend',
    sub: 'Total supplier / ingredient bill',
    options: [
      { label: 'Under ₹1L',  value: 80_000  },
      { label: '₹1L – ₹2L', value: 150_000 },
      { label: '₹2L – ₹4L', value: 300_000 },
      { label: '₹4L – ₹8L', value: 600_000 },
      { label: 'Above ₹8L', value: 1_000_000 },
    ],
  },
  {
    id: 'waste', label: 'What % of ordered food goes to waste daily?',
    sub: 'Leftovers, expired stock, over-prep — as % of raw material',
    options: [
      { label: 'Under 3%',      value: 0.03 },
      { label: '3% – 7%',      value: 0.05 },
      { label: '7% – 12%',     value: 0.10 },
      { label: '12% – 20%',    value: 0.16 },
      { label: 'More than 20%',value: 0.25 },
    ],
  },
  {
    id: 'staffing', label: 'How many extra staff on busy days vs slow days?',
    sub: 'Difference between your busiest Saturday and slowest weekday',
    options: [
      { label: 'Same every day',    value: 0  },
      { label: '1–2 extra',        value: 2  },
      { label: '3–5 extra',        value: 4  },
      { label: '6–10 extra',       value: 8  },
      { label: 'More than 10',     value: 12 },
    ],
  },
  {
    id: 'overorder', label: 'How often do unused ingredients pile up end of week?',
    sub: 'Vegetables that wilt, proteins that freeze, dry goods that accumulate',
    options: [
      { label: 'Rarely — our ordering is tight',      value: 0.01 },
      { label: 'Sometimes — once or twice a week',    value: 0.03 },
      { label: 'Often — most days something',         value: 0.05 },
      { label: 'Always — storeroom full of dead stock', value: 0.08 },
    ],
  },
];

const STAFF_DAILY_COST = 800;

function computeSavings(answers: Record<string, number>) {
  const raw        = answers.rawmaterial ?? 0;
  const wasteRate  = answers.waste       ?? 0;
  const extraStaff = answers.staffing    ?? 0;
  const overRate   = answers.overorder   ?? 0;

  const wasteSaving     = Math.round(raw * wasteRate * 0.30);
  const overorderSaving = Math.round(raw * overRate  * 0.40);
  const labourSaving    = Math.round(extraStaff * 0.4 * 8 * STAFF_DAILY_COST * 0.20);
  const total           = wasteSaving + overorderSaving + labourSaving;

  return { wasteSaving, overorderSaving, labourSaving, total };
}

function recommendPlan(total: number) {
  if (total < 10_000)  return PLANS[0];
  if (total < 30_000)  return PLANS[1];
  if (total < 70_000)  return PLANS[2];
  if (total < 150_000) return PLANS[3];
  return PLANS[4];
}

function fmt(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1000)    return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

// ── Page ──────────────────────────────────────────────────────

type KPIsWithRevenue = { today_revenue: number; daily_target: number };

export default function RevenuePage() {
  const [kpis,    setKpis]    = useState<KPIsWithRevenue | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [step,    setStep]    = useState(0);

  const refresh = useCallback(async () => {
    try { setKpis((await fetchKPIs(VENUE)) as unknown as KPIsWithRevenue); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [refresh]);

  const complete = Object.keys(answers).length === QUESTIONS.length;
  const savings  = complete ? computeSavings(answers) : null;
  const plan     = savings  ? recommendPlan(savings.total) : null;

  function pick(qId: string, value: number) {
    const next = { ...answers, [qId]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) setStep(step + 1);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div className="page-header">
        <div>
          <div className="page-title">💰 Revenue</div>
          <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 2 }}>
            Owner View · Today's revenue + savings potential
          </div>
        </div>
        <RoleSwitcher />
      </div>

      <div className="page-content" style={{ maxWidth: 640 }}>

        {/* ── LIVE REVENUE BAR — always at top ── */}
        {kpis !== null && (
          <div style={{ marginBottom: 28 }}>
            <RevenueBar
              revenue={kpis.today_revenue}
              target={kpis.daily_target}
            />
            {kpis.today_revenue === 0 && (
              <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.3)',
                marginTop: 6, textAlign: 'center' }}>
                Revenue tracked from bill amounts logged on the Staff page.
                Set target: add <code style={{ color: 'var(--gold-400)' }}>DAILY_REVENUE_TARGET=50000</code> to .env
              </div>
            )}
          </div>
        )}

        <div style={{ borderTop: '1px solid rgba(245,240,232,0.08)',
          paddingTop: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Savings Potential Calculator
          </div>
          <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)' }}>
            Answer 5 questions to see what SANGATI saves your venue monthly.
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {QUESTIONS.map((q, i) => (
            <div key={q.id} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i < Object.keys(answers).length
                ? 'var(--gold-500)'
                : i === step ? 'rgba(245,200,66,0.4)' : 'rgba(245,240,232,0.1)',
              cursor: i < Object.keys(answers).length ? 'pointer' : 'default',
            }} onClick={() => { if (i < Object.keys(answers).length) setStep(i); }} />
          ))}
        </div>

        {/* Current question */}
        {!complete && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.4)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Question {step + 1} of {QUESTIONS.length}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--cream)', marginBottom: 4 }}>
              {QUESTIONS[step].label}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(245,240,232,0.5)', marginBottom: 18 }}>
              {QUESTIONS[step].sub}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {QUESTIONS[step].options.map(opt => {
                const isSel = answers[QUESTIONS[step].id] === opt.value;
                return (
                  <button key={opt.value} className="btn btn-outline"
                    style={{
                      justifyContent: 'flex-start', padding: '10px 16px',
                      background:   isSel ? 'rgba(245,200,66,0.15)' : undefined,
                      borderColor:  isSel ? 'var(--gold-500)' : undefined,
                      color:        isSel ? 'var(--gold-400)' : undefined,
                    }}
                    onClick={() => pick(QUESTIONS[step].id, opt.value)}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Results */}
        {complete && savings && plan && (
          <>
            <div className="card" style={{ marginBottom: 16, borderColor: `${plan.color}50` }}>
              <div style={{ fontSize: 11, color: plan.color, textTransform: 'uppercase',
                letterSpacing: '0.06em', marginBottom: 12 }}>
                Recommended: {plan.name} · ₹{plan.monthly.toLocaleString()}/mo
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.4)', marginBottom: 4 }}>You pay</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#EF4444' }}>{fmt(plan.monthly)}</div>
                  <div style={{ fontSize: 10, color: 'rgba(245,240,232,0.3)' }}>per month</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.4)', marginBottom: 4 }}>You save</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#22C55E' }}>{fmt(savings.total)}</div>
                  <div style={{ fontSize: 10, color: 'rgba(245,240,232,0.3)' }}>per month</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'rgba(245,240,232,0.4)', marginBottom: 4 }}>Net gain</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: plan.color }}>
                    {fmt(savings.total - plan.monthly)}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(245,240,232,0.3)' }}>every month</div>
                </div>
              </div>
              <div style={{ background: `${plan.color}12`, border: `1px solid ${plan.color}30`,
                borderRadius: 8, padding: '10px 16px', textAlign: 'center',
                fontSize: 14, color: 'var(--cream)' }}>
                For every <strong style={{ color: plan.color }}>₹1</strong> paid →{' '}
                <strong style={{ color: '#22C55E', fontSize: 18 }}>
                  ₹{Math.round(savings.total / plan.monthly)}
                </strong> back
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(245,240,232,0.5)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
                Savings breakdown
              </div>
              {[
                { label: 'Waste reduction (30% of waste)', value: savings.wasteSaving, color: '#22C55E' },
                { label: 'Over-ordering (40% of dead stock)', value: savings.overorderSaving, color: '#3B82F6' },
                { label: 'Staff optimisation (20%)', value: savings.labourSaving, color: '#8B5CF6' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '8px 0',
                  borderBottom: '1px solid rgba(245,240,232,0.06)' }}>
                  <span style={{ fontSize: 13, color: 'rgba(245,240,232,0.7)' }}>{row.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: row.color }}>{fmt(row.value)}/mo</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between',
                paddingTop: 12, fontSize: 15, fontWeight: 800 }}>
                <span style={{ color: 'var(--cream)' }}>Total monthly savings</span>
                <span style={{ color: '#22C55E' }}>{fmt(savings.total)}</span>
              </div>
            </div>

            <button className="btn btn-outline" style={{ width: '100%' }}
              onClick={() => { setAnswers({}); setStep(0); }}>
              Recalculate
            </button>
          </>
        )}

      </div>
    </div>
  );
}
