export type CameraManufacturer =
  | 'Hikvision'
  | 'Dahua'
  | 'CPPlus'
  | 'Uniview'
  | 'Axis'
  | 'Reolink'
  | 'Generic';

export interface DiscoveredCamera {
  id: string;                    // cam-{ip-dashes}
  ip: string;
  port: number;                  // RTSP port (default 554)
  onvifPort: number;             // ONVIF HTTP port (default 80)
  manufacturer: CameraManufacturer | null;
  model: string | null;
  label: string;                 // "Camera 1 (Hikvision)"
  rtspUrls: RtspUrlSet;
  onvifCapable: boolean;
  status: 'discovered' | 'connected' | 'failed' | 'unconfigured';
  discoveredAt: string;          // ISO
  zoneId: string | null;         // mapped in setup UI
  channelIndex: number;          // NVR channel (1-based)
}

export interface RtspUrlSet {
  mainStream: string;            // 1080p/4K — on-demand only
  subStream: string;             // 640x480 — always use for AI
}

export interface NvrDevice {
  id: string;
  ip: string;
  manufacturer: CameraManufacturer;
  model: string | null;
  channels: number;              // total channels
  cameras: DiscoveredCamera[];   // one per active channel
  onvifServiceUrl: string;
  sadpDiscovered: boolean;       // found via Hikvision SADP UDP 37020
}

export interface StreamHealth {
  cameraId: string;
  connected: boolean;
  fps: number;
  lastFrameAt: string | null;
  reconnectCount: number;
  errorMessage: string | null;
}

export interface OccupancyReading {
  cameraId: string;
  zoneId: string;
  tableId: string;
  occupied: boolean;
  confidence: number;            // 0.0–1.0
  personCount: number;
  timestamp: string;
}
