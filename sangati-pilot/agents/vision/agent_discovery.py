"""
SANGATI — Camera Discovery Agent (Agent 20A)

Scans the local network for IP cameras using:
  1. Hikvision SADP (UDP broadcast, port 37020) — finds Hikvision NVRs/DVRs/cameras
  2. ONVIF WS-Discovery (multicast probe)
  3. RTSP port scan (fallback for non-ONVIF cameras)

Returns a list of discovered cameras with stream URLs.
Posts results to SANGATI API: POST /api/cameras/discovered

Runs on demand (triggered from /cameras setup page) or at startup.
"""

import asyncio
import socket
import ipaddress
import logging
import os
import re
import xml.etree.ElementTree as ET
import httpx
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime

log = logging.getLogger("agent.discovery")

API_BASE     = os.getenv("SANGATI_API_URL", "http://localhost:3847")
RTSP_PORT    = 554
ALT_RTSP     = 8554
SCAN_TIMEOUT = 0.4   # seconds per host
MAX_WORKERS  = 64

# Common RTSP stream path patterns by manufacturer
RTSP_PATH_PATTERNS = [
    "/stream1",
    "/live/ch00_0",
    "/h264/ch1/main/av_stream",   # Hikvision
    "/cam/realmonitor?channel=1&subtype=0",  # Dahua
    "/videoMain",
    "/live.sdp",
    "/MediaInput/h264",
    "/video1",
    "/streaming/channels/101",    # Hikvision alt
    "/0",
    "/1",
]

SADP_PORT  = 37020
SADP_PROBE = """<?xml version="1.0" encoding="UTF-8"?>
<Probe>
  <Uuid>SANGATI-DISCOVERY-001</Uuid>
  <Types>inquiry</Types>
</Probe>"""

# NVR channel RTSP URL template (Hikvision DS-7604NI-K1 and similar)
NVR_CHANNEL_PATHS = [
    "/Streaming/Channels/101",
    "/Streaming/Channels/201",
    "/Streaming/Channels/301",
    "/Streaming/Channels/401",
]

ONVIF_PROBE = """<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:sangati-probe-001</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe>
  </e:Body>
</e:Envelope>"""


@dataclass
class SadpDevice:
    """Parsed response from a single Hikvision SADP probe reply."""
    ip:                str
    device_type:       Optional[str]  # NVR / DVR / IPCamera
    model:             Optional[str]
    serial:            Optional[str]
    activation_status: str            # 'activated' | 'not_activated'


@dataclass
class DiscoveredCamera:
    id:                str
    ip:                str
    port:              int
    stream_url:        str
    manufacturer:      Optional[str]
    label:             str
    source:            str  = 'rtsp_scan'   # 'sadp' | 'onvif' | 'rtsp_scan'
    discovered_at:     str  = field(default_factory=lambda: datetime.utcnow().isoformat())
    onvif:             bool = False
    model:             Optional[str]  = None
    serial:            Optional[str]  = None
    activation_status: Optional[str]  = None
    candidate_urls:    list  = field(default_factory=list)  # extra stream options


# ── ONVIF Discovery ────────────────────────────────────────────

async def onvif_probe(timeout: float = 3.0) -> list[str]:
    """Send WS-Discovery multicast probe, return list of responding IPs."""
    ips: list[str] = []
    loop = asyncio.get_event_loop()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 4)
    sock.settimeout(timeout)
    sock.setblocking(False)

    target = ("239.255.255.250", 3702)

    try:
        await loop.run_in_executor(None, lambda: sock.sendto(ONVIF_PROBE.encode(), target))
        deadline = asyncio.get_event_loop().time() + timeout

        while asyncio.get_event_loop().time() < deadline:
            try:
                data, addr = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: sock.recvfrom(4096)),
                    timeout=0.5
                )
                ip = addr[0]
                if ip not in ips:
                    ips.append(ip)
                    log.info(f"[discovery] ONVIF response from {ip}")
            except asyncio.TimeoutError:
                break
            except Exception:
                break
    except Exception as e:
        log.debug(f"[discovery] ONVIF probe error: {e}")
    finally:
        sock.close()

    return ips


# ── Hikvision SADP Discovery ───────────────────────────────────

def _parse_sadp_response(data: bytes, sender_ip: str) -> Optional[SadpDevice]:
    """Parse a Hikvision SADP XML response packet into a SadpDevice."""
    try:
        root = ET.fromstring(data.decode("utf-8", errors="replace"))
        # Strip namespace prefixes if present
        tag = root.tag.split("}")[-1] if "}" in root.tag else root.tag
        if tag not in ("ProbeMatch", "Probe"):
            return None

        def get(name: str) -> Optional[str]:
            # Try with and without namespace
            el = root.find(name)
            if el is None:
                # Search children by local name
                for child in root.iter():
                    local = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                    if local == name:
                        return child.text
                return None
            return el.text

        # Prefer the IP reported in the packet; fall back to sender address
        ip = get("IPv4Address") or sender_ip
        if ip:
            ip = ip.strip()

        device_type = get("DeviceType")
        model       = get("DeviceDescription") or get("Model")
        serial      = get("DeviceSN") or get("SerialNumber")
        activated   = get("Activated") or get("activated") or ""
        status      = "activated" if activated.strip().lower() in ("true", "yes", "1") else "not_activated"

        return SadpDevice(
            ip                = ip or sender_ip,
            device_type       = device_type.strip() if device_type else None,
            model             = model.strip() if model else None,
            serial            = serial.strip() if serial else None,
            activation_status = status,
        )
    except ET.ParseError:
        return None


async def sadp_probe(timeout: float = 3.0) -> list[SadpDevice]:
    """
    Send a Hikvision SADP broadcast probe to 255.255.255.255:37020 and
    collect responses for `timeout` seconds.

    Returns a list of SadpDevice objects, one per responding Hikvision device.
    """
    devices: list[SadpDevice] = []
    seen_ips: set[str] = set()
    loop = asyncio.get_event_loop()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(0.5)
    sock.setblocking(False)

    payload = SADP_PROBE.strip().encode("utf-8")

    try:
        await loop.run_in_executor(
            None, lambda: sock.sendto(payload, ("255.255.255.255", SADP_PORT))
        )
        log.info("[discovery] SADP probe sent to 255.255.255.255:37020")

        deadline = loop.time() + timeout
        while loop.time() < deadline:
            try:
                data, addr = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: sock.recvfrom(4096)),
                    timeout=0.5,
                )
                sender_ip = addr[0]
                if sender_ip in seen_ips:
                    continue
                device = _parse_sadp_response(data, sender_ip)
                if device:
                    seen_ips.add(sender_ip)
                    devices.append(device)
                    log.info(
                        f"[discovery] SADP response: {device.ip} "
                        f"type={device.device_type} model={device.model} "
                        f"serial={device.serial} status={device.activation_status}"
                    )
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                log.debug(f"[discovery] SADP recv error: {e}")
                break
    except Exception as e:
        log.debug(f"[discovery] SADP probe error: {e}")
    finally:
        sock.close()

    return devices


def nvr_channel_urls(ip: str, port: int = RTSP_PORT) -> list[str]:
    """Generate standard Hikvision NVR channel stream URLs for a 4-channel NVR."""
    return [f"rtsp://{ip}:{port}{path}" for path in NVR_CHANNEL_PATHS]


# ── RTSP Port Scan ─────────────────────────────────────────────

async def check_rtsp_port(ip: str, port: int) -> bool:
    """Returns True if RTSP port is open on host."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=SCAN_TIMEOUT
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


async def scan_subnet(subnet: str) -> list[str]:
    """Scan entire /24 subnet for open RTSP ports. Returns IPs with cameras."""
    log.info(f"[discovery] Scanning subnet {subnet}")
    network = ipaddress.IPv4Network(subnet, strict=False)
    hosts   = list(network.hosts())

    semaphore = asyncio.Semaphore(MAX_WORKERS)

    async def check(host: ipaddress.IPv4Address) -> Optional[str]:
        async with semaphore:
            ip = str(host)
            if await check_rtsp_port(ip, RTSP_PORT) or await check_rtsp_port(ip, ALT_RTSP):
                return ip
        return None

    tasks = [check(h) for h in hosts]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if isinstance(r, str)]


def get_local_subnet() -> str:
    """Detect local machine's subnet."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        # Return /24 subnet
        parts = local_ip.rsplit(".", 1)
        return f"{parts[0]}.0/24"
    except Exception:
        return "192.168.1.0/24"


# ── Stream URL Builder ─────────────────────────────────────────

def build_rtsp_url(ip: str, port: int = RTSP_PORT, path: str = "/stream1") -> str:
    return f"rtsp://{ip}:{port}{path}"


def detect_manufacturer(ip: str) -> Optional[str]:
    """Quick HTTP probe to detect camera manufacturer from HTTP headers."""
    for port in [80, 8080]:
        try:
            r = httpx.get(f"http://{ip}:{port}/", timeout=1.0)
            server = r.headers.get("server", "").lower()
            if "hikvision" in server: return "Hikvision"
            if "dahua"     in server: return "Dahua"
            if "axis"      in server: return "Axis"
            if "bosch"     in server: return "Bosch"
            # Check body for brand hints
            body = r.text.lower()
            for brand in ["hikvision", "dahua", "axis", "hanwha", "uniview", "reolink"]:
                if brand in body:
                    return brand.capitalize()
        except Exception:
            pass
    return None


# ── Main Discovery ─────────────────────────────────────────────

async def discover_cameras() -> list[DiscoveredCamera]:
    """Full discovery: SADP probe + ONVIF probe + subnet RTSP scan."""
    log.info("[discovery] Starting camera discovery…")

    # Run SADP and ONVIF probes concurrently
    sadp_devices, onvif_ips = await asyncio.gather(
        sadp_probe(),
        onvif_probe(),
    )

    # Subnet RTSP scan
    subnet   = get_local_subnet()
    rtsp_ips = await scan_subnet(subnet)

    # Build lookup of SADP devices by IP
    sadp_by_ip: dict[str, SadpDevice] = {d.ip: d for d in sadp_devices}
    sadp_ips   = list(sadp_by_ip.keys())

    # Merge all IPs, deduplicate
    all_ips = list(dict.fromkeys(sadp_ips + onvif_ips + rtsp_ips))
    log.info(
        f"[discovery] Candidates — SADP: {len(sadp_ips)}, "
        f"ONVIF: {len(onvif_ips)}, RTSP: {len(rtsp_ips)}, total unique: {len(all_ips)}"
    )

    cameras: list[DiscoveredCamera] = []
    for i, ip in enumerate(all_ips):
        port  = RTSP_PORT
        onvif = ip in onvif_ips
        sadp  = sadp_by_ip.get(ip)
        mfr   = "Hikvision" if sadp else detect_manufacturer(ip)

        # Determine discovery source (prefer most informative)
        if sadp:
            source = "sadp"
        elif onvif:
            source = "onvif"
        else:
            source = "rtsp_scan"

        # Pick primary stream URL
        if mfr == "Hikvision":
            stream_url = build_rtsp_url(ip, port, "/h264/ch1/main/av_stream")
        else:
            stream_url = build_rtsp_url(ip, port, RTSP_PATH_PATTERNS[0])

        # For SADP-discovered NVRs, generate channel candidate URLs
        candidate_urls: list[str] = []
        if sadp and sadp.device_type and "nvr" in sadp.device_type.lower():
            candidate_urls = nvr_channel_urls(ip, port)
            stream_url = candidate_urls[0]  # default to channel 1

        label = f"Camera {i + 1}"
        if sadp and sadp.model:
            label = f"{sadp.model} ({ip})"
        elif mfr:
            label = f"Camera {i + 1} ({mfr})"

        cam = DiscoveredCamera(
            id                = f"cam-{ip.replace('.', '-')}",
            ip                = ip,
            port              = port,
            stream_url        = stream_url,
            manufacturer      = mfr,
            label             = label,
            source            = source,
            onvif             = onvif,
            model             = sadp.model if sadp else None,
            serial            = sadp.serial if sadp else None,
            activation_status = sadp.activation_status if sadp else None,
            candidate_urls    = candidate_urls,
        )
        cameras.append(cam)

    return cameras


async def run_discovery_and_post(zone_map: dict[str, str] | None = None) -> list[dict]:
    """Run discovery and POST results to SANGATI API."""
    cameras = await discover_cameras()

    payload = []
    for cam in cameras:
        d = asdict(cam)
        if zone_map:
            d["zone_id"] = zone_map.get(cam.id)
        payload.append(d)

    if payload:
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{API_BASE}/api/cameras/discovered",
                    json=payload,
                    timeout=5.0,
                )
            log.info(f"[discovery] Posted {len(payload)} cameras to API")
        except Exception as e:
            log.warning(f"[discovery] Failed to post to API: {e}")

    return payload


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    result = asyncio.run(run_discovery_and_post())
    print(f"\nFound {len(result)} cameras:")
    for c in result:
        extras = []
        if c.get("model"):   extras.append(f"model={c['model']}")
        if c.get("serial"):  extras.append(f"serial={c['serial']}")
        if c.get("activation_status"): extras.append(c["activation_status"])
        detail = f"  [{c['source'].upper()}] {c['label']} — {c['stream_url']}"
        if extras:
            detail += f"  ({', '.join(extras)})"
        print(detail)
        for url in c.get("candidate_urls", []):
            print(f"      channel: {url}")
