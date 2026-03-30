import { useEffect, useRef, useCallback } from 'react';
import type { WsMessage, WsMessageType } from '@sangati/shared';

type Handler = (payload: unknown) => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3847';
const RECONNECT_DELAY_MS = 3000;

export function useWebSocket(handlers: Partial<Record<WsMessageType | 'ping', Handler>>): {
  connected: boolean;
} {
  const wsRef       = useRef<WebSocket | null>(null);
  const connRef     = useRef(false);
  const mountedRef  = useRef(true);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const ws = new WebSocket(`${WS_URL}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        connRef.current = true;
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as WsMessage & { type: string };
          const h = handlersRef.current[msg.type as WsMessageType | 'ping'];
          if (h) h(msg.payload);
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        connRef.current = false;
        if (mountedRef.current) {
          setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      if (mountedRef.current) {
        setTimeout(connect, RECONNECT_DELAY_MS);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected: connRef.current };
}
