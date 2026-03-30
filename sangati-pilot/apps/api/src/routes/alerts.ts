import type { FastifyInstance } from 'fastify';
import { alertRepo, sessionRepo, zoneRepo, tableRepo } from '@sangati/db';
import { broadcast } from '../ws';
import type { AckAlertBody, AlertWithContext } from '@sangati/shared';

export async function alertsRoute(app: FastifyInstance): Promise<void> {
  // GET /api/alerts/active?role=&zone_id=
  app.get<{ Querystring: { role?: string; zone_id?: string } }>(
    '/api/alerts/active',
    async (req, reply) => {
      const { role, zone_id } = req.query;
      const alerts = alertRepo.findActiveByRoleAndZone(role, zone_id);

      // Enrich with session/table/zone context
      const enriched: AlertWithContext[] = alerts.map(a => {
        const session = sessionRepo.findById(a.session_id);
        const zone    = session ? zoneRepo.findById(session.zone_id) : null;
        return {
          ...a,
          table_label:        session?.table_id ?? undefined,
          zone_name:          zone?.name ?? undefined,
          session_started_at: session?.started_at ?? undefined,
        };
      });

      return reply.send(enriched);
    }
  );

  // GET /api/alerts/all — for manager dashboard (today)
  app.get<{ Querystring: { venue_id?: string } }>(
    '/api/alerts/all',
    async (req, reply) => {
      const alerts = alertRepo.findToday(req.query.venue_id);
      return reply.send(alerts);
    }
  );

  // POST /api/alerts/:id/ack
  app.post<{ Params: { id: string }; Body: AckAlertBody }>(
    '/api/alerts/:id/ack',
    async (req, reply) => {
      const alert = alertRepo.findById(req.params.id);
      if (!alert) return reply.status(404).send({ error: 'not found' });
      if (alert.acknowledged_at) {
        return reply.status(409).send({ error: 'already acknowledged' });
      }

      const now = new Date().toISOString();
      alertRepo.acknowledge(req.params.id, req.body.staff_id, now);

      const updated = alertRepo.findById(req.params.id);
      broadcast('alert.acknowledged', updated);

      return reply.send({ ok: true, alert: updated });
    }
  );
}
