import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { sessionRepo, eventRepo, venueRepo, zoneRepo, tableRepo } from '@sangati/db';
import { processSession, updateBaselinesForSession } from '@sangati/core';
import { broadcast } from '../ws';
import type { IngestEventBody } from '@sangati/shared';

export async function eventsRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: IngestEventBody }>('/api/events', async (req, reply) => {
    const body = req.body;

    if (!body.session_id || !body.type) {
      return reply.status(400).send({ error: 'session_id and type are required' });
    }

    const now    = body.ts ? new Date(body.ts) : new Date();
    const nowIso = now.toISOString();

    // Auto-create session if new
    let session = sessionRepo.findById(body.session_id);
    if (!session) {
      if (!body.venue_id || !body.table_id || !body.zone_id) {
        return reply.status(400).send({
          error: 'venue_id, table_id, zone_id required when creating a new session',
        });
      }
      venueRepo.upsert({ id: body.venue_id, name: body.venue_id });
      zoneRepo.upsert({ id: body.zone_id, venue_id: body.venue_id, name: body.zone_id });
      tableRepo.upsert({ id: body.table_id, venue_id: body.venue_id, zone_id: body.zone_id, label: body.table_id });
      session = {
        id: body.session_id,
        venue_id: body.venue_id,
        table_id: body.table_id,
        zone_id:  body.zone_id,
        started_at: nowIso,
        ended_at:   null,
        status:     'active',
      };
      sessionRepo.insert(session);
    }

    // Insert event
    const event = {
      id:         uuid(),
      session_id: body.session_id,
      type:       body.type,
      value:      body.value ?? null,
      ts:         nowIso,
    };
    eventRepo.insert(event);

    // Pay = close session
    if (body.type === 'pay') {
      sessionRepo.close(body.session_id, nowIso);
      broadcast('session.updated', { ...session, status: 'closed', ended_at: nowIso });

      // Update baselines and broadcast if any changed
      const updatedBaselines = updateBaselinesForSession(body.session_id);
      for (const b of updatedBaselines) {
        broadcast('baseline.updated', b);
      }

      return reply.send({ ok: true, event, session_closed: true });
    }

    // Run deviation engine
    const newAlerts = processSession(body.session_id, now);
    for (const alert of newAlerts) {
      broadcast('alert.created', alert);
    }

    const updated = sessionRepo.findById(body.session_id);
    broadcast('session.updated', updated);

    return reply.send({ ok: true, event, new_alerts: newAlerts.length });
  });
}
