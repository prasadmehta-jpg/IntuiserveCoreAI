import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import wsPlugin from '@fastify/websocket';
import { runMigrations } from '@sangati/db';
import { registerClient, unregisterClient, clientCount } from './ws';
import { startTicker } from './ticker';
import { eventsRoute }             from './routes/events';
import { sessionsRoute }           from './routes/sessions';
import { alertsRoute }             from './routes/alerts';
import { baselinesRoute, kpisRoute } from './routes/baselines';
import { setupRoute }              from './routes/setup';
import { camerasRoute }            from './routes/cameras';
import { complianceRoutes }        from './routes/compliance';
import { posRoute }                from './routes/pos';

const PORT = parseInt(process.env.API_PORT ?? '3847', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  runMigrations();

  const app = Fastify({ logger: { level: 'warn' } });

  await app.register(cors, { origin: true });
  await app.register(wsPlugin);

  // ── WebSocket ──────────────────────────────────────────────
  app.get('/ws', { websocket: true }, (socket) => {
    registerClient(socket);
    const total = clientCount();
    if (total <= 10) console.log(`[ws] Client connected (total: ${total})`);

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', ts: new Date().toISOString() }));
        }
      } catch { /* ignore */ }
    });

    socket.on('close', () => { unregisterClient(socket); });
    socket.on('error', () => { unregisterClient(socket); });
    socket.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
  });

  // ── REST Routes ────────────────────────────────────────────
  await app.register(eventsRoute);
  await app.register(sessionsRoute);
  await app.register(alertsRoute);
  await app.register(baselinesRoute);
  await app.register(kpisRoute);
  await app.register(setupRoute);
  await app.register(camerasRoute);
  await app.register(complianceRoutes);
  await app.register(posRoute);

  // Health
  app.get('/health', async () => ({
    ok: true,
    ts: new Date().toISOString(),
    ws_clients: clientCount(),
  }));

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: 'not found' });
  });

  await app.listen({ port: PORT, host: HOST });
  console.log(`\n🍽  SANGATI API  →  http://localhost:${PORT}`);
  console.log(`   WebSocket    →  ws://localhost:${PORT}/ws`);
  console.log(`   Web UI       →  http://localhost:3000\n`);

  startTicker();
}

main().catch(err => {
  console.error('[boot] Fatal:', err);
  process.exit(1);
});
