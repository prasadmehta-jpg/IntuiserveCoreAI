import type { FastifyInstance } from 'fastify';
import { getDb, dbTransaction } from '@sangati/db';
import { discoverAllCameras } from '@sangati/camera';
import { fetchStreamHealth, startStream, stopStream } from '@sangati/camera';
import { broadcast } from '../ws';
import { randomUUID } from 'crypto';

export async function camerasRoute(app: FastifyInstance): Promise<void> {

  // POST /api/cameras/discover
  // Runs full multi-protocol network discovery. Takes ~5–8 seconds.
  app.post('/api/cameras/discover', async (req, reply) => {
    const venueId = (req.query as Record<string, string>).venue_id ?? 'venue-001';

    try {
      const result = await discoverAllCameras();
      const db = getDb();

      const insertCamera = db.prepare(`
        INSERT INTO cameras
          (id, venue_id, ip, rtsp_main, rtsp_sub, manufacturer, model, label,
           channel_index, onvif_capable, status, added_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          ip            = excluded.ip,
          rtsp_main     = excluded.rtsp_main,
          rtsp_sub      = excluded.rtsp_sub,
          manufacturer  = excluded.manufacturer,
          label         = excluded.label,
          updated_at    = datetime('now')
      `);

      const insertNvr = db.prepare(`
        INSERT INTO nvrs
          (id, venue_id, ip, manufacturer, model, channels, onvif_service_url, sadp_discovered, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET ip = excluded.ip
      `);

      dbTransaction(() => {
        for (const nvr of result.nvrs) {
          insertNvr.run(
            nvr.id, venueId, nvr.ip, nvr.manufacturer, nvr.model,
            nvr.channels, nvr.onvifServiceUrl, nvr.sadpDiscovered ? 1 : 0
          );
          for (const cam of nvr.cameras) {
            insertCamera.run(
              cam.id, venueId, cam.ip,
              cam.rtspUrls.mainStream, cam.rtspUrls.subStream,
              cam.manufacturer, cam.model, cam.label,
              cam.channelIndex, cam.onvifCapable ? 1 : 0
            );
          }
        }

        const knownIds = new Set(
          result.nvrs.flatMap((n) => n.cameras.map((c) => c.id))
        );
        for (const cam of result.cameras) {
          if (knownIds.has(cam.id)) continue;
          insertCamera.run(
            cam.id, venueId, cam.ip,
            cam.rtspUrls.mainStream, cam.rtspUrls.subStream,
            cam.manufacturer, cam.model, cam.label,
            cam.channelIndex, cam.onvifCapable ? 1 : 0
          );
        }
      });

      const totalCameras =
        result.cameras.length +
        result.nvrs.reduce((s, n) => s + n.cameras.length, 0);

      return reply.send({
        found:      totalCameras,
        cameras:    result.cameras.length,
        nvrs:       result.nvrs.length,
        durationMs: result.durationMs,
        data:       result,
      });
    } catch (err: unknown) {
      app.log.error(err);
      return reply.status(500).send({
        error:  'Discovery failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /api/cameras
  app.get('/api/cameras', async (req, reply) => {
    const venueId = (req.query as Record<string, string>).venue_id ?? 'venue-001';
    const db = getDb();
    const cameras = db.prepare(
      'SELECT * FROM cameras WHERE venue_id = ? AND active = 1 ORDER BY channel_index'
    ).all(venueId);
    return reply.send(cameras);
  });

  // PATCH /api/cameras/:id/zone — map a camera to a zone
  app.patch<{ Params: { id: string }; Body: { zone_id: string } }>(
    '/api/cameras/:id/zone',
    async (req, reply) => {
      const { id } = req.params;
      const { zone_id } = req.body;
      getDb().prepare(
        `UPDATE cameras SET zone_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(zone_id, id);
      return reply.send({ ok: true });
    }
  );

  // PATCH /api/cameras/:id/credentials
  // Flag that credentials have been set (credentials themselves stored in OS keychain — not here)
  app.patch<{ Params: { id: string } }>(
    '/api/cameras/:id/credentials',
    async (req, reply) => {
      const { id } = req.params;
      getDb().prepare(
        `UPDATE cameras SET credentials_set = 1, updated_at = datetime('now') WHERE id = ?`
      ).run(id);
      return reply.send({
        ok: true,
        note: 'Credentials stored in OS keychain, not in SANGATI database.',
      });
    }
  );

  // POST /api/cameras/:id/start — instruct vision service to start streaming
  app.post<{ Params: { id: string } }>(
    '/api/cameras/:id/start',
    async (req, reply) => {
      const { id } = req.params;
      const db = getDb();
      const cam = db.prepare('SELECT * FROM cameras WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!cam) return reply.status(404).send({ error: 'Camera not found' });
      if (!cam.zone_id) {
        return reply.status(400).send({ error: 'Camera must be mapped to a zone before starting' });
      }

      const ok = await startStream(id, cam.rtsp_sub as string, cam.zone_id as string);
      if (ok) {
        db.prepare(`UPDATE cameras SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(id);
        db.prepare(
          `INSERT INTO camera_stream_log (id, camera_id, event, message, ts)
           VALUES (?, ?, 'connected', 'Stream started', datetime('now'))`
        ).run(randomUUID(), id);
      }
      return reply.send({ ok, cameraId: id });
    }
  );

  // POST /api/cameras/:id/stop
  app.post<{ Params: { id: string } }>(
    '/api/cameras/:id/stop',
    async (req, reply) => {
      const { id } = req.params;
      const db = getDb();
      const ok = await stopStream(id);
      if (ok) {
        db.prepare(`UPDATE cameras SET status = 'inactive', updated_at = datetime('now') WHERE id = ?`).run(id);
        db.prepare(
          `INSERT INTO camera_stream_log (id, camera_id, event, message, ts)
           VALUES (?, ?, 'disconnected', 'Stream stopped', datetime('now'))`
        ).run(randomUUID(), id);
      }
      return reply.send({ ok, cameraId: id });
    }
  );

  // GET /api/cameras/health
  app.get('/api/cameras/health', async (req, reply) => {
    const venueId = (req.query as Record<string, string>).venue_id ?? 'venue-001';
    const db = getDb();
    const rows = db.prepare(
      `SELECT id FROM cameras WHERE venue_id = ? AND status = 'active'`
    ).all(venueId) as { id: string }[];
    const health = await fetchStreamHealth(rows.map((r) => r.id));
    return reply.send(health);
  });

  // POST /api/cameras/occupancy — called by sangati-vision to push occupancy readings
  app.post<{
    Body: Array<{
      camera_id: string; zone_id: string; table_id: string;
      occupied: boolean; confidence: number; person_count: number;
    }>;
  }>('/api/cameras/occupancy', async (req, reply) => {
    const readings = req.body ?? [];
    const db = getDb();

    const insert = db.prepare(`
      INSERT INTO occupancy_readings
        (id, camera_id, zone_id, table_id, occupied, confidence, person_count, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    dbTransaction(() => {
      for (const r of readings) {
        insert.run(randomUUID(), r.camera_id, r.zone_id, r.table_id,
          r.occupied ? 1 : 0, r.confidence, r.person_count);
      }
    });

    broadcast('occupancy.updated', readings);
    return reply.send({ ok: true, count: readings.length });
  });

  // Legacy: POST /api/cameras/:id/status — called by old vision agent to update occupancy
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/cameras/:id/status',
    async (req, reply) => {
      const id = req.params.id;
      app.log.warn(`Deprecated: /api/cameras/${id}/status — use /api/cameras/occupancy`);
      return reply.send({ ok: true });
    }
  );

  // Legacy: GET /api/cameras/status — kept for old web client compatibility
  app.get('/api/cameras/status', async (_req, reply) => {
    return reply.send({ cameras: 0, agents: [] });
  });
}
