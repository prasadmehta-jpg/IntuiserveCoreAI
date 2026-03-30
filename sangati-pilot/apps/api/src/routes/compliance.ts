/**
 * DPDPA (Digital Personal Data Protection Act 2023) compliance routes.
 * Required before pilot goes live.
 */

import type { FastifyInstance } from 'fastify';
import { getDb, dbTransaction } from '@sangati/db';

export async function complianceRoutes(app: FastifyInstance): Promise<void> {

  // POST /api/compliance/consent
  // Called when restaurant owner accepts terms on first run.
  app.post<{
    Body: { venue_id: string; accepted_by: string; version: string };
  }>('/api/compliance/consent', async (req, reply) => {
    const { venue_id, accepted_by, version } = req.body;

    getDb().prepare(`
      INSERT OR REPLACE INTO venue_config (venue_id, key, value, updated_at)
      VALUES (?, 'consent_given', ?, datetime('now'))
    `).run(venue_id, JSON.stringify({
      accepted: true,
      accepted_by,
      version,
      timestamp: new Date().toISOString(),
      ip_address: req.ip,
    }));

    return reply.send({ ok: true, message: 'Consent recorded.' });
  });

  // GET /api/compliance/consent/:venue_id
  app.get<{ Params: { venue_id: string } }>(
    '/api/compliance/consent/:venue_id',
    async (req, reply) => {
      const { venue_id } = req.params;
      const row = getDb().prepare(
        `SELECT value, updated_at FROM venue_config WHERE venue_id = ? AND key = 'consent_given'`
      ).get(venue_id) as { value: string; updated_at: string } | undefined;

      if (!row) return reply.send({ consented: false });
      return reply.send({
        consented: true,
        details:   JSON.parse(row.value) as unknown,
        at:        row.updated_at,
      });
    }
  );

  // DELETE /api/compliance/data/:venue_id
  // Data deletion right under DPDPA Section 12.
  app.delete<{
    Params: { venue_id: string };
    Body: { confirm: boolean };
  }>('/api/compliance/data/:venue_id', async (req, reply) => {
    const { venue_id } = req.params;
    const { confirm } = req.body ?? {};

    if (!confirm) {
      return reply.status(400).send({ error: 'Set confirm: true to proceed with data deletion.' });
    }

    const db = getDb();

    dbTransaction(() => {
      const sessionRows = db.prepare(
        `SELECT id FROM sessions WHERE venue_id = ?`
      ).all(venue_id) as { id: string }[];

      if (sessionRows.length > 0) {
        const ids = sessionRows.map((r) => r.id);
        const ph  = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM events WHERE session_id IN (${ph})`).run(...ids);
        db.prepare(`DELETE FROM session_features WHERE session_id IN (${ph})`).run(...ids);
        db.prepare(`DELETE FROM decisions WHERE session_id IN (${ph})`).run(...ids);
        db.prepare(`DELETE FROM alerts WHERE session_id IN (${ph})`).run(...ids);
      }

      db.prepare(`DELETE FROM sessions WHERE venue_id = ?`).run(venue_id);

      db.prepare(`
        DELETE FROM occupancy_readings
        WHERE zone_id IN (SELECT id FROM zones WHERE venue_id = ?)
      `).run(venue_id);

      db.prepare(`
        DELETE FROM camera_stream_log
        WHERE camera_id IN (SELECT id FROM cameras WHERE venue_id = ?)
      `).run(venue_id);
    });

    app.log.info({ venue_id }, 'DPDPA data deletion executed');

    return reply.send({
      ok:      true,
      message: 'All session, event, alert, and occupancy data deleted for this venue.',
      note:    'Staff, shift, and baseline configuration retained.',
    });
  });
}
