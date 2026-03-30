import type { FastifyInstance } from 'fastify';
import { sessionRepo, eventRepo, featureRepo, alertRepo, zoneRepo, decisionRepo } from '@sangati/db';
import { updateBaselinesForSession } from '@sangati/core';
import { broadcast } from '../ws';

export async function sessionsRoute(app: FastifyInstance): Promise<void> {
  // GET /api/sessions/active
  app.get<{ Querystring: { venue_id?: string } }>('/api/sessions/active', async (req, reply) => {
    const { venue_id } = req.query;
    const sessions = venue_id
      ? sessionRepo.findActiveByVenue(venue_id)
      : sessionRepo.findActive();

    const enriched = sessions.map(s => {
      const zone     = zoneRepo.findById(s.zone_id);
      const features = featureRepo.findBySession(s.id);
      const alerts   = alertRepo.findBySession(s.id).filter(a => !a.acknowledged_at);
      const events   = eventRepo.findBySession(s.id);
      const lastEvent = events[events.length - 1];

      return {
        ...s,
        zone_name:        zone?.name ?? s.zone_id,
        features,
        active_alerts:    alerts.length,
        highest_severity: alerts.length > 0
          ? (alerts.some(a => a.severity === 'high') ? 'high'
            : alerts.some(a => a.severity === 'med') ? 'med' : 'low')
          : null,
        last_event_type: lastEvent?.type ?? null,
        last_event_ts:   lastEvent?.ts ?? null,
        event_count:     events.length,
      };
    });

    return reply.send(enriched);
  });

  // GET /api/sessions/:id
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const session = sessionRepo.findById(req.params.id);
    if (!session) return reply.status(404).send({ error: 'not found' });

    return reply.send({
      session,
      events:    eventRepo.findBySession(req.params.id),
      features:  featureRepo.findBySession(req.params.id),
      alerts:    alertRepo.findBySession(req.params.id),
      decisions: decisionRepo.findBySession(req.params.id),
    });
  });

  // POST /api/sessions/:id/close
  app.post<{ Params: { id: string } }>('/api/sessions/:id/close', async (req, reply) => {
    const session = sessionRepo.findById(req.params.id);
    if (!session) return reply.status(404).send({ error: 'not found' });
    if (session.status === 'closed') return reply.status(409).send({ error: 'already closed' });

    const now = new Date().toISOString();
    sessionRepo.close(req.params.id, now);
    broadcast('session.updated', { ...session, status: 'closed', ended_at: now });

    const updatedBaselines = updateBaselinesForSession(req.params.id);
    for (const b of updatedBaselines) {
      broadcast('baseline.updated', b);
    }

    return reply.send({ ok: true });
  });
}
