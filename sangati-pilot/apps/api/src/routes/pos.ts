import type { FastifyInstance } from 'fastify';
import { startPOSBridge, stopPOSBridge, getPOSStatus } from '../../../../integrations/pos/petpooja';
import type { PetpoojaConfig } from '../../../../integrations/pos/petpooja';

export async function posRoute(app: FastifyInstance): Promise<void> {

  // GET /api/pos/status
  app.get('/api/pos/status', async (_req, reply) => {
    return reply.send(getPOSStatus());
  });

  // POST /api/pos/connect — configure and start POS bridge
  app.post<{ Body: PetpoojaConfig }>('/api/pos/connect', async (req, reply) => {
    const { base_url, api_key, restaurant_id, venue_id, poll_interval } = req.body;
    if (!base_url || !api_key || !restaurant_id || !venue_id) {
      return reply.status(400).send({ error: 'base_url, api_key, restaurant_id, venue_id required' });
    }
    startPOSBridge({ base_url, api_key, restaurant_id, venue_id, poll_interval: poll_interval ?? 10_000 });
    return reply.send({ ok: true, status: getPOSStatus() });
  });

  // POST /api/pos/disconnect
  app.post('/api/pos/disconnect', async (_req, reply) => {
    stopPOSBridge();
    return reply.send({ ok: true });
  });

  // POST /api/pos/webhook — receive push events from Petpooja (if configured)
  app.post<{ Body: { event: string; order: Record<string, unknown> } }>(
    '/api/pos/webhook',
    async (req, reply) => {
      // Petpooja can be configured to POST to this endpoint on order status changes
      console.log('[pos] Webhook received:', req.body?.event);
      // TODO: process webhook event same as poll
      return reply.send({ ok: true });
    }
  );
}
