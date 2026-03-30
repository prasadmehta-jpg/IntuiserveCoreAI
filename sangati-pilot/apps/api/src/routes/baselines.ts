import type { FastifyInstance } from 'fastify';
import { baselineRepo, alertRepo, sessionRepo, featureRepo, dbAll } from '@sangati/db';
import type { KPIs } from '@sangati/shared';

export async function baselinesRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { venue_id?: string; zone_id?: string } }>(
    '/api/baselines',
    async (req, reply) => {
      const { venue_id, zone_id } = req.query;
      if (venue_id && zone_id) {
        return reply.send(baselineRepo.findByVenueZone(venue_id, zone_id));
      }
      return reply.send(baselineRepo.findAll());
    }
  );
}

// ── Revenue helpers ───────────────────────────────────────────

/** Sum today's pay event values (bill amounts logged by staff or POS) */
function getTodayRevenue(venueId?: string): number {
  const today = new Date().toISOString().slice(0, 10);
  let sql = `
    SELECT COALESCE(SUM(e.value), 0) as total
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.type = 'pay'
      AND e.value IS NOT NULL
      AND DATE(e.ts) = ?
  `;
  const params: unknown[] = [today];
  if (venueId) { sql += ` AND s.venue_id = ?`; params.push(venueId); }
  const row = dbAll<{ total: number }>(sql, params)[0];
  return row?.total ?? 0;
}

/** Daily target: read from env or default ₹50,000 */
function getDailyTarget(): number {
  return parseInt(process.env.DAILY_REVENUE_TARGET ?? '50000', 10);
}

// ── KPIs ─────────────────────────────────────────────────────

export async function kpisRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { venue_id?: string } }>(
    '/api/kpis',
    async (req, reply) => {
      const { venue_id } = req.query;
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const activeSessions = venue_id
        ? sessionRepo.findActiveByVenue(venue_id)
        : sessionRepo.findActive();

      const todayAlerts = alertRepo.findToday(venue_id);

      const hoursSinceMidnight = Math.max(
        (now.getTime() - todayStart.getTime()) / 3_600_000,
        0.5
      );

      const allFeatures = activeSessions
        .map(s => featureRepo.findBySession(s.id))
        .filter(Boolean);

      const avgAttend = allFeatures.length
        ? allFeatures.reduce((s, f) => s + (f?.wait_time_sec ?? 0), 0) / allFeatures.length
        : 0;
      const avgKitchen = allFeatures.length
        ? allFeatures.reduce((s, f) => s + (f?.kitchen_delay_sec ?? 0), 0) / allFeatures.length
        : 0;

      const closedToday  = venue_id ? sessionRepo.findClosedToday(venue_id) : [];
      const allSessions  = [...activeSessions, ...closedToday];
      const multiAlert   = allSessions.filter(s =>
        alertRepo.findBySession(s.id).length > 1
      ).length;
      const pctMulti = allSessions.length
        ? Math.round((multiAlert / allSessions.length) * 100) : 0;

      const ackedToday = todayAlerts.filter(a => a.acknowledged_at);
      const avgAck = ackedToday.length
        ? ackedToday.reduce((sum, a) => {
            const latency = (new Date(a.acknowledged_at!).getTime() -
              new Date(a.created_at).getTime()) / 1000;
            return sum + latency;
          }, 0) / ackedToday.length
        : 0;

      // Revenue
      const todayRevenue = getTodayRevenue(venue_id);
      const dailyTarget  = getDailyTarget();

      const kpis: KPIs & { today_revenue: number; daily_target: number } = {
        avg_attend_latency_sec:            Math.round(avgAttend),
        avg_kitchen_delay_sec:             Math.round(avgKitchen),
        alerts_per_hour:                   parseFloat((todayAlerts.length / hoursSinceMidnight).toFixed(1)),
        sessions_with_multiple_alerts_pct: pctMulti,
        avg_ack_latency_sec:               Math.round(avgAck),
        active_sessions:                   activeSessions.length,
        total_alerts_today:                todayAlerts.length,
        today_revenue:                     todayRevenue,
        daily_target:                      dailyTarget,
      };

      return reply.send(kpis);
    }
  );
}
