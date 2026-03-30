import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3847';

interface Camera {
  id: string;
  label: string;
  ip: string;
  manufacturer: string | null;
  model: string | null;
  zone_id: string | null;
  status: 'discovered' | 'active' | 'inactive' | 'failed';
  channel_index: number;
  rtsp_sub: string;
  credentials_set: number;
}

interface StreamHealth {
  cameraId: string;
  connected: boolean;
  fps: number;
  lastFrameAt: string | null;
  errorMessage: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  active:     'text-green-400 bg-green-900/30 border-green-700',
  discovered: 'text-amber-400 bg-amber-900/30 border-amber-700',
  inactive:   'text-gray-400 bg-gray-900/30 border-gray-700',
  failed:     'text-red-400 bg-red-900/30 border-red-700',
};

const MFR_BADGE: Record<string, string> = {
  Hikvision: 'bg-red-900/40 text-red-300',
  Dahua:     'bg-blue-900/40 text-blue-300',
  CPPlus:    'bg-orange-900/40 text-orange-300',
  Axis:      'bg-purple-900/40 text-purple-300',
  Reolink:   'bg-cyan-900/40 text-cyan-300',
  Generic:   'bg-gray-900/40 text-gray-300',
};

export default function CamerasPage() {
  const [cameras, setCameras]           = useState<Camera[]>([]);
  const [health, setHealth]             = useState<Record<string, StreamHealth>>({});
  const [discovering, setDiscovering]   = useState(false);
  const [loading, setLoading]           = useState(true);
  const [discoverTime, setDiscoverTime] = useState<number | null>(null);

  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/cameras`);
      if (res.ok) setCameras(await res.json() as Camera[]);
    } catch { /* api may not be ready */ }
    setLoading(false);
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/cameras/health`);
      if (res.ok) {
        const list = await res.json() as StreamHealth[];
        setHealth(Object.fromEntries(list.map((h) => [h.cameraId, h])));
      }
    } catch { /* vision service may be offline */ }
  }, []);

  useEffect(() => {
    fetchCameras();
    const interval = setInterval(fetchHealth, 10_000);
    return () => clearInterval(interval);
  }, [fetchCameras, fetchHealth]);

  const runDiscovery = async () => {
    setDiscovering(true);
    try {
      const res = await fetch(`${API}/api/cameras/discover`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { durationMs: number };
        setDiscoverTime(data.durationMs);
        await fetchCameras();
      }
    } catch { /* ignore */ }
    setDiscovering(false);
  };

  const toggleStream = async (cam: Camera) => {
    const endpoint = cam.status === 'active' ? 'stop' : 'start';
    if (endpoint === 'start' && !cam.zone_id) {
      alert('Map this camera to a zone first in Setup → Zone Assignments.');
      return;
    }
    await fetch(`${API}/api/cameras/${cam.id}/${endpoint}`, { method: 'POST' });
    await fetchCameras();
  };

  return (
    <div className="min-h-screen bg-[#080A14] text-white p-6">

      {/* Privacy notice — DPDPA required */}
      <div className="mb-6 bg-[#0C1020] border border-amber-700/50 rounded-lg p-4 flex gap-3">
        <span className="text-amber-400 text-lg">&#x1F512;</span>
        <div>
          <p className="text-amber-300 font-semibold text-sm">Camera Privacy Notice</p>
          <p className="text-gray-400 text-xs mt-1">
            This system detects table occupancy only. No faces are identified or stored.
            No footage or frame data leaves this device. All analysis runs locally.
            Staff are informed of camera monitoring as required by applicable labour law.
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Camera Management</h1>
          <p className="text-gray-400 text-sm mt-1">
            {cameras.length} camera{cameras.length !== 1 ? 's' : ''} registered
            {discoverTime !== null && ` · Last scan ${(discoverTime / 1000).toFixed(1)}s`}
          </p>
        </div>
        <button
          onClick={runDiscovery}
          disabled={discovering}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-teal-900 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {discovering ? '⟳ Scanning network…' : '⊕ Discover Cameras'}
        </button>
      </div>

      {/* Empty state */}
      {cameras.length === 0 && !loading && (
        <div className="text-center py-20 text-gray-500">
          <p className="text-4xl mb-4">&#x1F4F7;</p>
          <p className="text-lg mb-2">No cameras registered yet</p>
          <p className="text-sm">
            Click &ldquo;Discover Cameras&rdquo; to scan for ONVIF, Hikvision SADP, and RTSP devices
          </p>
        </div>
      )}

      {/* Camera cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cameras.map((cam) => {
          const h = health[cam.id];
          return (
            <div key={cam.id} className="bg-[#0D1120] border border-[#1C2340] rounded-xl p-5">

              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-white">{cam.label}</p>
                  <p className="text-gray-500 text-xs font-mono mt-0.5">
                    {cam.ip} · Ch {cam.channel_index}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[cam.status] ?? STATUS_COLORS.inactive}`}>
                    {cam.status}
                  </span>
                  {cam.manufacturer && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${MFR_BADGE[cam.manufacturer] ?? MFR_BADGE.Generic}`}>
                      {cam.manufacturer}
                    </span>
                  )}
                </div>
              </div>

              {/* Health metrics */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-[#111828] rounded-lg p-2 text-center">
                  <p className="text-xs text-gray-500">Stream</p>
                  <p className={`text-sm font-bold ${h?.connected ? 'text-green-400' : 'text-gray-600'}`}>
                    {h ? (h.connected ? 'Live' : 'Off') : '—'}
                  </p>
                </div>
                <div className="bg-[#111828] rounded-lg p-2 text-center">
                  <p className="text-xs text-gray-500">FPS</p>
                  <p className="text-sm font-bold text-white">{h?.fps ?? '—'}</p>
                </div>
                <div className="bg-[#111828] rounded-lg p-2 text-center">
                  <p className="text-xs text-gray-500">Zone</p>
                  <p className="text-sm font-bold text-teal-400 truncate">
                    {cam.zone_id ? cam.zone_id.replace('zone-', 'Z') : '—'}
                  </p>
                </div>
              </div>

              {/* Warnings */}
              {!cam.credentials_set && (
                <p className="text-xs text-amber-400 bg-amber-900/20 rounded p-2 mb-3">
                  &#x26A0; Camera credentials not configured. Go to Setup to add credentials.
                </p>
              )}
              {!cam.zone_id && (
                <p className="text-xs text-blue-400 bg-blue-900/20 rounded p-2 mb-3">
                  &#x2139; Map to a zone in Setup &#x2192; Zone Assignments to enable AI analysis.
                </p>
              )}
              {h?.errorMessage && (
                <p className="text-xs text-red-400 bg-red-900/20 rounded p-2 mb-3 truncate">
                  &#x2715; {h.errorMessage}
                </p>
              )}

              {/* RTSP URL (masked) */}
              <p className="text-xs font-mono text-gray-600 truncate mb-3" title={cam.rtsp_sub}>
                {cam.rtsp_sub.replace(/:[^:@]+@/, ':***@')}
              </p>

              <button
                onClick={() => toggleStream(cam)}
                disabled={!cam.credentials_set}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  cam.status === 'active'
                    ? 'bg-red-900/40 text-red-300 hover:bg-red-800/50 border border-red-800'
                    : 'bg-teal-900/40 text-teal-300 hover:bg-teal-800/50 border border-teal-800 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                {cam.status === 'active' ? '&#x23F9; Stop Stream' : '&#x25B6; Start Stream'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Discovery protocol legend */}
      <div className="mt-8 bg-[#0D1120] border border-[#1C2340] rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-300 mb-3">Discovery Protocols</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-500">
          <div className="flex gap-2">
            <span className="text-teal-400">&#x25CF;</span>
            <div>
              <p className="text-gray-300 font-medium">ONVIF WS-Discovery</p>
              <p>Multicast probe to 239.255.255.250:3702. Works with all ONVIF-capable cameras.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-red-400">&#x25CF;</span>
            <div>
              <p className="text-gray-300 font-medium">Hikvision SADP</p>
              <p>UDP broadcast on port 37020. Mirrors iVMS-4200 discovery. Detects DS-7604NI-K1 NVR.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-amber-400">&#x25CF;</span>
            <div>
              <p className="text-gray-300 font-medium">RTSP Port Scan</p>
              <p>Subnet scan for port 554. Catches cameras that do not respond to ONVIF probes.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
