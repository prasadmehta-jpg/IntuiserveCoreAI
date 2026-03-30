/**
 * SANGATI Camera Discovery Engine
 *
 * Multi-protocol discovery pipeline (runs in parallel):
 * 1. ONVIF WS-Discovery multicast (239.255.255.250:3702)
 * 2. Hikvision SADP protocol (UDP 37020) — mirrors iVMS-4200
 * 3. Subnet RTSP port scan (port 554)
 * 4. HTTP header manufacturer fingerprinting
 *
 * BRAND-SPECIFIC RTSP URL PATTERNS (reverse-engineered):
 * Hikvision:  rtsp://user:pass@IP:554/Streaming/Channels/101 (main)
 *             rtsp://user:pass@IP:554/Streaming/Channels/102 (sub)
 * Dahua:      rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0
 *             rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=1
 * CP Plus:    rtsp://user:pass@IP:554/stream1 (main)
 *             rtsp://user:pass@IP:554/stream2 (sub)
 * Uniview:    rtsp://user:pass@IP:554/unicast/c1/s1/live (main)
 *             rtsp://user:pass@IP:554/unicast/c1/s2/live (sub)
 * Axis:       rtsp://user:pass@IP:554/axis-media/media.amp
 * Reolink:    rtsp://user:pass@IP:554/h264Preview_01_main
 *             rtsp://user:pass@IP:554/h264Preview_01_sub
 * Generic:    rtsp://user:pass@IP:554/stream1
 */

import * as dgram from 'dgram';
import * as net from 'net';
import * as http from 'http';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { DiscoveredCamera, CameraManufacturer, RtspUrlSet, NvrDevice } from './types';

// ── Constants ─────────────────────────────────────────────────────

const ONVIF_MULTICAST_ADDR = '239.255.255.250';
const ONVIF_MULTICAST_PORT = 3702;
const SADP_PORT            = 37020;        // Hikvision SADP
const RTSP_PORT            = 554;
const SCAN_TIMEOUT_MS      = 5000;
const CONNECT_TIMEOUT_MS   = 1500;

// ── RTSP URL Builders ─────────────────────────────────────────────

export function buildRtspUrls(
  ip: string,
  manufacturer: CameraManufacturer | null,
  channel: number = 1,
  creds: { user: string; pass: string } = { user: 'admin', pass: '' }
): RtspUrlSet {
  const { user, pass } = creds;
  const auth = pass ? `${user}:${pass}@` : `${user}:@`;
  const base = `rtsp://${auth}${ip}:${RTSP_PORT}`;

  switch (manufacturer) {
    case 'Hikvision':
      return {
        mainStream: `${base}/Streaming/Channels/${channel}01`,
        subStream:  `${base}/Streaming/Channels/${channel}02`,
      };
    case 'Dahua':
      return {
        mainStream: `${base}/cam/realmonitor?channel=${channel}&subtype=0`,
        subStream:  `${base}/cam/realmonitor?channel=${channel}&subtype=1`,
      };
    case 'CPPlus':
      return {
        mainStream: `${base}/stream${channel}`,
        subStream:  `${base}/stream${channel + 1}`,
      };
    case 'Uniview':
      return {
        mainStream: `${base}/unicast/c${channel}/s1/live`,
        subStream:  `${base}/unicast/c${channel}/s2/live`,
      };
    case 'Axis':
      return {
        mainStream: `${base}/axis-media/media.amp?resolution=1920x1080`,
        subStream:  `${base}/axis-media/media.amp?resolution=640x480`,
      };
    case 'Reolink':
      return {
        mainStream: `${base}/h264Preview_0${channel}_main`,
        subStream:  `${base}/h264Preview_0${channel}_sub`,
      };
    default:
      return {
        mainStream: `${base}/stream1`,
        subStream:  `${base}/stream2`,
      };
  }
}

// ── ONVIF WS-Discovery ────────────────────────────────────────────

function buildOnvifProbe(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope
  xmlns:e="http://www.w3.org/2003/05/soap-envelope"
  xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:${randomUUID()}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;
}

function extractIpsFromOnvifResponse(xml: string): string[] {
  const ips: string[] = [];
  const xaddrsMatch = xml.match(/XAddrs[^>]*>([^<]+)<\/[^:]*XAddrs/g) ?? [];
  for (const m of xaddrsMatch) {
    const ipMatch = m.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch) ips.push(ipMatch[1]);
  }
  return [...new Set(ips)];
}

async function onvifProbe(timeoutMs = SCAN_TIMEOUT_MS): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const ips: string[] = [];
    const probe = Buffer.from(buildOnvifProbe(), 'utf8');

    socket.on('message', (msg) => {
      const found = extractIpsFromOnvifResponse(msg.toString());
      ips.push(...found);
    });

    socket.on('error', () => { /* ignore */ });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
        socket.send(probe, 0, probe.length, ONVIF_MULTICAST_PORT, ONVIF_MULTICAST_ADDR);
      } catch { /* ignore bind failures on restricted networks */ }
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve([...new Set(ips)]);
    }, timeoutMs);
  });
}

// ── Hikvision SADP Protocol (UDP 37020) ───────────────────────────
// Mirrors iVMS-4200 device discovery behaviour

const SADP_PROBE = Buffer.from([
  0x20, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);

async function sadpProbe(timeoutMs = SCAN_TIMEOUT_MS): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const ips: string[] = [];

    socket.on('message', (_msg, rinfo) => {
      if (rinfo.address && rinfo.address !== '0.0.0.0') {
        ips.push(rinfo.address);
      }
    });

    socket.on('error', () => { /* non-Hikvision networks will refuse */ });

    socket.bind(SADP_PORT, () => {
      try {
        socket.setBroadcast(true);
        socket.send(SADP_PROBE, 0, SADP_PROBE.length, SADP_PORT, '255.255.255.255');
      } catch { /* ignore */ }
    });

    setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve([...new Set(ips)]);
    }, timeoutMs);
  });
}

// ── Subnet RTSP Port Scan ─────────────────────────────────────────

function getLocalSubnet(): string {
  const ifaces = os.networkInterfaces();
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && addr.address !== '127.0.0.1') {
        const parts = addr.address.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}`;
      }
    }
  }
  return '192.168.1';
}

async function checkPort(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, ip);
  });
}

async function scanSubnetForRtsp(subnet: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<string[]> {
  const checks: Promise<{ ip: string; open: boolean }>[] = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    checks.push(
      checkPort(ip, RTSP_PORT, timeoutMs).then((open) => ({ ip, open }))
    );
  }

  const results = await Promise.all(checks);
  return results.filter((r) => r.open).map((r) => r.ip);
}

// ── Manufacturer Detection via HTTP Header Probe ──────────────────

async function detectManufacturer(ip: string): Promise<CameraManufacturer | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}/`, { timeout: 1500 }, (res) => {
      const serverHeader = res.headers['server'];
      const server = (Array.isArray(serverHeader) ? serverHeader.join(' ') : serverHeader ?? '').toLowerCase();
      const body: string[] = [];
      res.on('data', (d: Buffer) => body.push(d.toString()));
      res.on('end', () => {
        const combined = server + ' ' + body.join('').toLowerCase();
        if (combined.includes('hikvision') || combined.includes('dvrdvs'))     resolve('Hikvision');
        else if (combined.includes('dahua') || combined.includes('rpc/2.0'))   resolve('Dahua');
        else if (combined.includes('axis'))                                     resolve('Axis');
        else if (combined.includes('uniview'))                                  resolve('Uniview');
        else if (combined.includes('reolink'))                                  resolve('Reolink');
        else if (combined.includes('cp plus') || combined.includes('cpplus'))   resolve('CPPlus');
        else resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── Main Discovery Orchestrator ───────────────────────────────────

export interface DiscoveryResult {
  cameras: DiscoveredCamera[];
  nvrs: NvrDevice[];
  durationMs: number;
}

export async function discoverAllCameras(): Promise<DiscoveryResult> {
  const start = Date.now();

  const [onvifIps, sadpIps, rtspIps] = await Promise.all([
    onvifProbe(),
    sadpProbe(),
    scanSubnetForRtsp(getLocalSubnet()),
  ]);

  const allIps = [...new Set([...onvifIps, ...sadpIps, ...rtspIps])];

  const cameras: DiscoveredCamera[] = await Promise.all(
    allIps.map(async (ip, index) => {
      const manufacturer = await detectManufacturer(ip);
      const mfr: CameraManufacturer | null =
        sadpIps.includes(ip) && !manufacturer ? 'Hikvision' : manufacturer;

      return {
        id:            `cam-${ip.replace(/\./g, '-')}`,
        ip,
        port:          RTSP_PORT,
        onvifPort:     80,
        manufacturer:  mfr,
        model:         null,
        label:         `Camera ${index + 1}${mfr ? ` (${mfr})` : ''}`,
        rtspUrls:      buildRtspUrls(ip, mfr, 1),
        onvifCapable:  onvifIps.includes(ip),
        status:        'discovered' as const,
        discoveredAt:  new Date().toISOString(),
        zoneId:        null,
        channelIndex:  1,
      };
    })
  );

  // Group Hikvision SADP IPs as NVR (DS-7604NI-K1 = 4-channel)
  const nvrs: NvrDevice[] = [];
  if (sadpIps.length > 0) {
    const nvrIp = sadpIps[0];
    const nvrCameras: DiscoveredCamera[] = Array.from({ length: 4 }, (_, i) => {
      const ch = i + 1;
      return {
        id:           `cam-${nvrIp.replace(/\./g, '-')}-ch${ch}`,
        ip:           nvrIp,
        port:         RTSP_PORT,
        onvifPort:    80,
        manufacturer: 'Hikvision' as const,
        model:        'DS-7604NI-K1',
        label:        `NVR Channel ${ch}`,
        rtspUrls:     buildRtspUrls(nvrIp, 'Hikvision', ch),
        onvifCapable: true,
        status:       'discovered' as const,
        discoveredAt: new Date().toISOString(),
        zoneId:       null,
        channelIndex: ch,
      };
    });

    nvrs.push({
      id:              `nvr-${nvrIp.replace(/\./g, '-')}`,
      ip:              nvrIp,
      manufacturer:    'Hikvision',
      model:           'DS-7604NI-K1',
      channels:        4,
      cameras:         nvrCameras,
      onvifServiceUrl: `http://${nvrIp}/onvif/device_service`,
      sadpDiscovered:  true,
    });
  }

  return { cameras, nvrs, durationMs: Date.now() - start };
}
