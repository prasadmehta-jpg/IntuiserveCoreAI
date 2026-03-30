# Sangati NVR Discovery Engine

Browser-based dashboard for scanning your LAN for NVR/DVR devices and registering them with Sangati VMS.

**Route:** `/nvr-discovery`
**File:** `apps/web/NVRDiscoveryDashboard.jsx`

---

## How It Works — 5-Stage Pipeline

| Stage | Name | What It Does |
|-------|------|--------------|
| 01 | Subnet Sweep | TCP connect scan across all IPs in the CIDR range using parallel thread pools |
| 02 | Port Probe | Hits NVR signature ports in priority order; early-exits on first match |
| 03 | Fingerprint | HTTP banner grab + ONVIF `GetDeviceInformation` SOAP call → brand, model, firmware, MAC |
| 04 | RTSP Validate | Probes brand-specific RTSP paths to confirm live stream availability |
| 05 | Sangati Bridge | Pushes confirmed devices to Sangati `/api/v2/devices/register` with full connection manifest |

---

## Scan Strategies

| Strategy | Threads | Timeout | Use Case |
|----------|---------|---------|----------|
| Quick | 64 | 500ms | Fast sweep, top ports only |
| Standard | 32 | 1500ms | All NVR ports, balanced |
| Deep | 16 | 3000ms | Full fingerprint + ONVIF probe |
| Stealth | 4 | 5000ms | Low-profile, rate-limited |

---

## Target Ports

| Port | Protocol | Service |
|------|----------|---------|
| 554 | RTSP | Real Time Streaming |
| 80 | HTTP | Web Interface |
| 443 | HTTPS | Secure Web |
| 8080 | HTTP-ALT | Alt Web Interface |
| 8000 | SDK | Hikvision ISAPI |
| 8899 | ONVIF | ONVIF Discovery |
| 37777 | SDK | Dahua SDK |
| 34567 | SDK | XMEye / Generic |
| 9000 | API | Sangati Bridge |
| 5000 | API | Sangati REST API |

---

## Supported Brands

| Brand | SDK Port | RTSP Path |
|-------|----------|-----------|
| Hikvision | 8000 | `/Streaming/Channels/101` |
| Dahua | 37777 | `/cam/realmonitor?channel=1&subtype=0` |
| Axis | — | `/axis-media/media.amp` |
| CP Plus | 34567 | `/live/ch00_0` |
| Hanwha/Samsung | — | `/profile1/media.smp` |
| Uniview | — | `/unicast/c1/s0/live` |
| Bosch | — | `/rtsp_tunnel` |
| Genetec | — | `/media/video1` |

---

## Dashboard Tabs

- **Scanner** — CIDR input, strategy picker, port legend, live progress bar, stage indicator, discovery log
- **Results** — Expandable device table (IP, brand, model, open ports, RTSP status, ONVIF, registration state)
- **Sangati VMS** — Endpoint + token config, bulk push, RTSP stream manifest
- **Pipeline** — Visual stage diagram, brand port matrix, credential vault reference

---

## Credential Handling

Credentials are **never** stored in scan output or exported JSON.
All NVR credentials are referenced via vault at runtime:

```
vault://sangati/nvr-creds/<brand>
```

Examples:
- `vault://sangati/nvr-creds/hikvision`
- `vault://sangati/nvr-creds/dahua`
- `vault://sangati/nvr-creds/cp-plus`

---

## Export Format

`Export JSON` produces a file named `sangati-nvr-scan-<timestamp>.json`:

```json
{
  "exportedAt": "2026-03-30T10:00:00.000Z",
  "cidr": "192.168.1.0/24",
  "strategy": "standard",
  "totalHostsScanned": 254,
  "devicesFound": 3,
  "devices": [
    {
      "ip": "192.168.1.42",
      "brand": "Hikvision",
      "model": "Hikvision-NVR-16CH",
      "firmware": "V4.62.210",
      "mac": "AA:BB:CC:DD:EE:FF",
      "channels": 16,
      "openPorts": [8000, 554, 80],
      "rtspStatus": "OK",
      "rtspPath": "rtsp://192.168.1.42/Streaming/Channels/101",
      "onvif": false,
      "credentials": "vault://sangati/nvr-creds/hikvision"
    }
  ]
}
```

---

## Sangati VMS Integration

**Endpoint:** `POST /api/v2/devices/register`

```http
POST http://localhost:9000/api/v2/devices/register
Authorization: Bearer <sangati-service-token>
Content-Type: application/json
```

Use **Register** on individual rows in the Results tab, or **Push All** in the Sangati VMS tab.

---

## Running Locally

```bash
cd C:\Users\Prasad\sangati-pilot\apps\web
pnpm dev
```

Open: `http://localhost:3000/nvr-discovery`

> **Note:** CIDR ranges `/16`–`/30` are supported. Maximum 4096 hosts per scan in the browser simulator.
