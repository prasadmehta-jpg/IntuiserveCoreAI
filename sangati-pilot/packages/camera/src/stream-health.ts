/**
 * Stream health monitor.
 * Pings sangati-vision Python service for each camera's health status.
 * sangati-vision handles the actual RTSP connection; this module tracks state.
 */

import type { StreamHealth } from './types';

const VISION_API_BASE = process.env.VISION_API_URL ?? 'http://localhost:8001';

interface VisionStreamStatus {
  camera_id: string;
  connected: boolean;
  fps: number;
  last_frame_ts: string | null;
  reconnect_count: number;
  error: string | null;
}

export async function fetchStreamHealth(cameraIds: string[]): Promise<StreamHealth[]> {
  try {
    const res = await fetch(`${VISION_API_BASE}/api/streams/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_ids: cameraIds }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) throw new Error(`Vision API ${res.status}`);

    const data: VisionStreamStatus[] = await res.json() as VisionStreamStatus[];
    return data.map((d) => ({
      cameraId:       d.camera_id,
      connected:      d.connected,
      fps:            d.fps,
      lastFrameAt:    d.last_frame_ts,
      reconnectCount: d.reconnect_count,
      errorMessage:   d.error,
    }));
  } catch {
    return cameraIds.map((id) => ({
      cameraId:       id,
      connected:      false,
      fps:            0,
      lastFrameAt:    null,
      reconnectCount: 0,
      errorMessage:   'Vision service unreachable',
    }));
  }
}

export async function startStream(cameraId: string, rtspUrl: string, zoneId: string): Promise<boolean> {
  try {
    const res = await fetch(`${VISION_API_BASE}/api/streams/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: cameraId, rtsp_url: rtspUrl, zone_id: zoneId }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function stopStream(cameraId: string): Promise<boolean> {
  try {
    const res = await fetch(`${VISION_API_BASE}/api/streams/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: cameraId }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
