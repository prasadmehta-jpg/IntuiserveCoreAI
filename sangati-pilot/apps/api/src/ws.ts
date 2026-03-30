import type { WsMessage, WsMessageType } from '@sangati/shared';

// In-memory set of active WebSocket connections
// Works with @fastify/websocket which wraps ws sockets
const clients = new Set<{ send: (data: string) => void; readyState: number }>();

export const WS_READY_OPEN = 1;

export function registerClient(socket: { send: (data: string) => void; readyState: number }): void {
  clients.add(socket);
}

export function unregisterClient(socket: { send: (data: string) => void; readyState: number }): void {
  clients.delete(socket);
}

export function broadcast<T>(type: WsMessageType, payload: T): void {
  const msg: WsMessage<T> = { type, payload, ts: new Date().toISOString() };
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WS_READY_OPEN) {
      try { client.send(data); } catch { /* ignore stale socket */ }
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
