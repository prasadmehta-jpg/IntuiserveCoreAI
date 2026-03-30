import { useState, useCallback, useRef, useEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const COMMON_NVR_PORTS = [
  { port: 554,   protocol: "RTSP",      desc: "Real Time Streaming" },
  { port: 80,    protocol: "HTTP",      desc: "Web Interface" },
  { port: 443,   protocol: "HTTPS",     desc: "Secure Web" },
  { port: 8080,  protocol: "HTTP-ALT",  desc: "Alt Web Interface" },
  { port: 8000,  protocol: "SDK",       desc: "Hikvision SDK" },
  { port: 8899,  protocol: "ONVIF",     desc: "ONVIF Discovery" },
  { port: 37777, protocol: "SDK",       desc: "Dahua SDK" },
  { port: 34567, protocol: "SDK",       desc: "XMEye/Generic" },
  { port: 9000,  protocol: "API",       desc: "Sangati Bridge" },
  { port: 5000,  protocol: "API",       desc: "Sangati REST API" },
];

const NVR_SIGNATURES = [
  { brand: "Hikvision",      pattern: "DVRDVS-Webs",  ports: [8000, 554, 80] },
  { brand: "Dahua",          pattern: "DH-NVR",       ports: [37777, 554, 80] },
  { brand: "Uniview",        pattern: "UNV-NVR",      ports: [554, 80, 8080] },
  { brand: "Axis",           pattern: "AXIS",          ports: [554, 80, 443] },
  { brand: "Hanwha/Samsung", pattern: "Samsung-NVR",  ports: [554, 80, 4520] },
  { brand: "CP Plus",        pattern: "CPPLUS",        ports: [34567, 554, 80] },
  { brand: "Bosch",          pattern: "BVMS",          ports: [554, 80, 443] },
  { brand: "Genetec",        pattern: "Synergy",       ports: [554, 443, 5500] },
  { brand: "Unknown",        pattern: "",              ports: [554, 80] },
];

const SCAN_STRATEGIES = {
  quick:    { name: "Quick Scan",    threads: 64, timeout: 500,  desc: "Top ports only, fast sweep" },
  standard: { name: "Standard Scan", threads: 32, timeout: 1500, desc: "All NVR ports, balanced" },
  deep:     { name: "Deep Scan",     threads: 16, timeout: 3000, desc: "All ports + fingerprinting + ONVIF probe" },
  stealth:  { name: "Stealth Scan",  threads: 4,  timeout: 5000, desc: "Low profile, rate-limited" },
};

const RTSP_PATHS = {
  Hikvision:      "/Streaming/Channels/101",
  Dahua:          "/cam/realmonitor?channel=1&subtype=0",
  Axis:           "/axis-media/media.amp",
  "CP Plus":      "/live/ch00_0",
  "Hanwha/Samsung": "/profile1/media.smp",
  Uniview:        "/unicast/c1/s0/live",
  Bosch:          "/rtsp_tunnel",
  Genetec:        "/media/video1",
  Unknown:        "/",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ipToLong(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
}

function longToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function parseCIDR(cidr) {
  try {
    const [base, bits] = cidr.trim().split("/");
    const prefixLen = parseInt(bits);
    if (isNaN(prefixLen) || prefixLen < 16 || prefixLen > 30) return null;
    const mask = ~((1 << (32 - prefixLen)) - 1) >>> 0;
    const network = (ipToLong(base) & mask) >>> 0;
    const broadcast = (network | ~mask) >>> 0;
    const hosts = [];
    for (let i = network + 1; i < broadcast; i++) hosts.push(longToIp(i));
    return hosts;
  } catch {
    return null;
  }
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomMac() {
  return Array.from({ length: 6 }, () => randomInt(0, 255).toString(16).padStart(2, "0").toUpperCase()).join(":");
}

function randomFirmware(brand) {
  const versions = { Hikvision: "V4.62.210", Dahua: "V2.800.0000014", Axis: "10.12.234", "CP Plus": "V3.0.8.5", Unknown: "V1.0.0" };
  return versions[brand] || `V${randomInt(1,5)}.${randomInt(0,9)}.${randomInt(0,9)}`;
}

function randomChannels() {
  return randomFrom([4, 8, 16, 32, 64]);
}

// Mock scanner — simulates the 5-stage pipeline with realistic timing
async function simulateScan(ip, strategy, onStageUpdate) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = { quick: 50, standard: 120, deep: 250, stealth: 600 }[strategy];
  const hitChance = 0.12; // ~12% of IPs are NVRs

  // Stage 1: Subnet sweep
  await delay(randomInt(base * 0.3, base * 0.6));
  onStageUpdate("sweep");

  // Stage 2: Port probe — most IPs will fail here
  await delay(randomInt(base * 0.4, base * 0.8));
  if (Math.random() > hitChance) return null; // no open NVR ports
  onStageUpdate("portscan");

  const sig = randomFrom(NVR_SIGNATURES.slice(0, -1)); // pick a real brand
  const openPorts = sig.ports.filter(() => Math.random() > 0.25);

  // Stage 3: Fingerprint
  await delay(randomInt(base, base * 2));
  onStageUpdate("fingerprint");
  const model = `${sig.brand.split("/")[0]}-NVR-${randomChannels()}CH`;
  const firmware = randomFirmware(sig.brand);
  const mac = randomMac();

  // Stage 4: RTSP validate
  await delay(randomInt(base * 0.5, base * 1.5));
  onStageUpdate("rtsp");
  const rtspOk = Math.random() > 0.2;
  const rtspPath = RTSP_PATHS[sig.brand] || "/";

  // Stage 5: Sangati bridge registration
  await delay(randomInt(base * 0.3, base * 0.8));
  onStageUpdate("bridge");

  return {
    id: `${Date.now()}-${ip.replace(/\./g, "")}`,
    ip,
    brand: sig.brand,
    model,
    firmware,
    mac,
    channels: randomChannels(),
    openPorts,
    rtspStatus: rtspOk ? "OK" : "AUTH",
    rtspPath: `rtsp://${ip}${rtspPath}`,
    onvif: openPorts.includes(8899),
    registeredToSangati: false,
    discoveredAt: new Date().toISOString(),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ label, color }) {
  const colors = {
    green:  "bg-green-900/60 text-green-300 border border-green-700",
    amber:  "bg-amber-900/60 text-amber-300 border border-amber-700",
    red:    "bg-red-900/60 text-red-300 border border-red-700",
    teal:   "bg-teal-900/60 text-teal-300 border border-teal-700",
    gray:   "bg-gray-800 text-gray-400 border border-gray-700",
    blue:   "bg-blue-900/60 text-blue-300 border border-blue-700",
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${colors[color] || colors.gray}`}>
      {label}
    </span>
  );
}

function PortPill({ port, protocol }) {
  const sdkPorts = [8000, 37777, 34567];
  const color = sdkPorts.includes(port) ? "amber" : port === 554 ? "teal" : "gray";
  return <Badge label={`${port}/${protocol}`} color={color} />;
}

function StageIndicator({ stage }) {
  const stages = [
    { id: "sweep",       label: "Subnet Sweep",     icon: "⬡" },
    { id: "portscan",    label: "Port Probe",        icon: "⬡" },
    { id: "fingerprint", label: "Fingerprint",       icon: "⬡" },
    { id: "rtsp",        label: "RTSP Validate",     icon: "⬡" },
    { id: "bridge",      label: "Sangati Bridge",    icon: "⬡" },
  ];
  const idx = stages.findIndex((s) => s.id === stage);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1">
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded-full border transition-all duration-300 ${
              i < idx
                ? "bg-teal-900/40 text-teal-400 border-teal-700"
                : i === idx
                ? "bg-teal-500/20 text-teal-300 border-teal-400 animate-pulse"
                : "bg-gray-800/60 text-gray-600 border-gray-700"
            }`}
          >
            {s.label}
          </span>
          {i < stages.length - 1 && <span className="text-gray-700 text-xs">›</span>}
        </div>
      ))}
    </div>
  );
}

function ArchitectureDiagram() {
  const stages = [
    {
      num: "01",
      name: "Subnet Sweep",
      color: "teal",
      icon: "⬡",
      detail: "Brute-force all IPs in CIDR range",
      sub: "TCP connect scan · configurable thread pools (4–64 workers) · parallel async execution",
    },
    {
      num: "02",
      name: "Port Probe",
      color: "blue",
      icon: "⬡",
      detail: "Hit signature NVR ports in priority order",
      sub: "554 RTSP → 80 HTTP → 8000 Hik SDK → 37777 Dahua SDK → 8899 ONVIF · early-exit on first match",
    },
    {
      num: "03",
      name: "Fingerprint",
      color: "purple",
      icon: "⬡",
      detail: "HTTP banner grab + ONVIF SOAP probe",
      sub: "GetDeviceInformation SOAP call · brand, model, firmware, MAC extraction · Hikvision ISAPI",
    },
    {
      num: "04",
      name: "RTSP Validate",
      color: "amber",
      icon: "⬡",
      detail: "Brand-specific RTSP path probing",
      sub: "/Streaming/Channels/101 (Hik) · /cam/realmonitor (Dahua) · /axis-media/media.amp (Axis)",
    },
    {
      num: "05",
      name: "Sangati Bridge",
      color: "green",
      icon: "⬡",
      detail: "Push discovered devices to Sangati VMS",
      sub: "POST /api/v2/devices/register · full connection manifest · credentials via vault:// reference",
    },
  ];

  const colorMap = {
    teal:   { border: "border-teal-600",   bg: "bg-teal-900/30",   text: "text-teal-300",   num: "bg-teal-700/50 text-teal-200" },
    blue:   { border: "border-blue-600",   bg: "bg-blue-900/30",   text: "text-blue-300",   num: "bg-blue-700/50 text-blue-200" },
    purple: { border: "border-purple-600", bg: "bg-purple-900/30", text: "text-purple-300", num: "bg-purple-700/50 text-purple-200" },
    amber:  { border: "border-amber-600",  bg: "bg-amber-900/30",  text: "text-amber-300",  num: "bg-amber-700/50 text-amber-200" },
    green:  { border: "border-green-600",  bg: "bg-green-900/30",  text: "text-green-300",  num: "bg-green-700/50 text-green-200" },
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">5-Stage Discovery Pipeline</h3>
        <p className="text-xs text-gray-500 mb-5">
          Each discovered IP passes through all five stages. Failed stages prune the candidate — only confirmed NVRs reach Stage 5.
        </p>
        <div className="space-y-3">
          {stages.map((s, i) => {
            const c = colorMap[s.color];
            return (
              <div key={s.num} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${c.num} shrink-0`}>
                    {s.num}
                  </div>
                  {i < stages.length - 1 && (
                    <div className="w-px flex-1 bg-gray-700 my-1" style={{ minHeight: 16 }} />
                  )}
                </div>
                <div className={`flex-1 rounded-lg border ${c.border} ${c.bg} p-3 mb-1`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-semibold text-sm ${c.text}`}>{s.name}</span>
                  </div>
                  <p className="text-xs text-gray-300 mb-1">{s.detail}</p>
                  <p className="text-xs text-gray-500 font-mono">{s.sub}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Brand port matrix */}
      <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Brand SDK Port Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left pb-2 pr-4">Brand</th>
                <th className="text-center pb-2 px-2">554</th>
                <th className="text-center pb-2 px-2">80</th>
                <th className="text-center pb-2 px-2">8000</th>
                <th className="text-center pb-2 px-2">8899</th>
                <th className="text-center pb-2 px-2">37777</th>
                <th className="text-center pb-2 px-2">34567</th>
                <th className="text-left pb-2 pl-4">RTSP Path</th>
              </tr>
            </thead>
            <tbody className="text-gray-400">
              {[
                { brand: "Hikvision",       p: [1,1,1,0,0,0], rtsp: "/Streaming/Channels/101" },
                { brand: "Dahua",           p: [1,1,0,0,1,0], rtsp: "/cam/realmonitor?ch=1" },
                { brand: "Axis",            p: [1,1,0,0,0,0], rtsp: "/axis-media/media.amp" },
                { brand: "CP Plus",         p: [1,1,0,0,0,1], rtsp: "/live/ch00_0" },
                { brand: "Hanwha/Samsung",  p: [1,1,0,0,0,0], rtsp: "/profile1/media.smp" },
                { brand: "Uniview",         p: [1,1,0,0,0,0], rtsp: "/unicast/c1/s0/live" },
                { brand: "Bosch",           p: [1,1,0,0,0,0], rtsp: "/rtsp_tunnel" },
                { brand: "Genetec",         p: [1,0,0,0,0,0], rtsp: "/media/video1" },
              ].map((row) => (
                <tr key={row.brand} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-1.5 pr-4 text-gray-300">{row.brand}</td>
                  {row.p.map((v, i) => (
                    <td key={i} className="text-center py-1.5 px-2">
                      {v ? <span className="text-teal-400">✓</span> : <span className="text-gray-700">·</span>}
                    </td>
                  ))}
                  <td className="py-1.5 pl-4 text-gray-500">{row.rtsp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Credential vault note */}
      <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
        <p className="text-xs text-amber-300 font-semibold mb-1">Credential Handling</p>
        <p className="text-xs text-amber-400/80">
          All NVR credentials are referenced via{" "}
          <span className="font-mono bg-amber-900/30 px-1 rounded">vault://sangati/nvr-creds/</span>
          {" "}— never stored in scan output or exported JSON. Vault resolves credentials at connection
          time using the active Sangati service account.
        </p>
      </div>
    </div>
  );
}

function DeviceRow({ device, onRegister }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        className="border-b border-gray-800 hover:bg-gray-800/40 cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-2.5 px-3 font-mono text-sm text-teal-300">{device.ip}</td>
        <td className="py-2.5 px-3 text-sm text-gray-200">{device.brand}</td>
        <td className="py-2.5 px-3 text-xs text-gray-400 font-mono">{device.model}</td>
        <td className="py-2.5 px-3">
          <div className="flex flex-wrap gap-1">
            {device.openPorts.map((p) => {
              const meta = COMMON_NVR_PORTS.find((x) => x.port === p);
              return <PortPill key={p} port={p} protocol={meta?.protocol || "TCP"} />;
            })}
          </div>
        </td>
        <td className="py-2.5 px-3">
          <Badge
            label={device.rtspStatus}
            color={device.rtspStatus === "OK" ? "green" : "amber"}
          />
        </td>
        <td className="py-2.5 px-3">
          {device.onvif
            ? <Badge label="ONVIF" color="teal" />
            : <span className="text-gray-600 text-xs">—</span>}
        </td>
        <td className="py-2.5 px-3">
          {device.registeredToSangati ? (
            <Badge label="Registered" color="green" />
          ) : (
            <button
              className="px-2 py-1 text-xs rounded bg-teal-700/40 text-teal-300 border border-teal-700 hover:bg-teal-600/50 transition-colors"
              onClick={(e) => { e.stopPropagation(); onRegister(device.id); }}
            >
              Register
            </button>
          )}
        </td>
        <td className="py-2.5 px-3 text-gray-600 text-xs">{expanded ? "▲" : "▼"}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-800 bg-gray-900/40">
          <td colSpan={8} className="px-6 py-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs font-mono">
              <div><span className="text-gray-500">MAC:</span> <span className="text-gray-300">{device.mac}</span></div>
              <div><span className="text-gray-500">Firmware:</span> <span className="text-gray-300">{device.firmware}</span></div>
              <div><span className="text-gray-500">Channels:</span> <span className="text-gray-300">{device.channels}CH</span></div>
              <div><span className="text-gray-500">Discovered:</span> <span className="text-gray-300">{new Date(device.discoveredAt).toLocaleTimeString()}</span></div>
              <div className="col-span-2">
                <span className="text-gray-500">RTSP URL:</span>{" "}
                <span className="text-teal-400">{device.rtspPath}</span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">Sangati config key:</span>{" "}
                <span className="text-amber-400">vault://sangati/nvr-creds/{device.brand.toLowerCase().replace(/\//g, "-")}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NVRDiscoveryDashboard() {
  const [tab, setTab] = useState("scanner"); // scanner | results | integration | architecture
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [strategy, setStrategy] = useState("standard");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);         // 0–100
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentStage, setCurrentStage] = useState(null);
  const [currentIP, setCurrentIP] = useState("");
  const [devices, setDevices] = useState([]);
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");
  const [sangatiEndpoint, setSangatiEndpoint] = useState("http://localhost:9000");
  const [sangatiToken, setSangatiToken] = useState("••••••••••••");
  const [pushStatus, setPushStatus] = useState(null);
  const abortRef = useRef(false);

  const appendLog = useCallback((msg, level = "info") => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLog((prev) => [...prev.slice(-199), { ts, msg, level }]);
  }, []);

  const startScan = useCallback(async () => {
    const hosts = parseCIDR(cidr);
    if (!hosts) { setError("Invalid CIDR. Use e.g. 192.168.1.0/24 (prefix /16–/30)"); return; }
    if (hosts.length > 4096) { setError("Range too large for browser simulation — use /20 or smaller"); return; }
    setError("");
    setDevices([]);
    setLog([]);
    setProgress(0);
    setScanned(0);
    setTotal(hosts.length);
    setScanning(true);
    abortRef.current = false;
    setTab("scanner");

    appendLog(`Starting ${SCAN_STRATEGIES[strategy].name} on ${cidr} — ${hosts.length} hosts`, "info");
    appendLog(`Threads: ${SCAN_STRATEGIES[strategy].threads} · Timeout: ${SCAN_STRATEGIES[strategy].timeout}ms`, "info");

    // Process in batches simulating thread pools
    const batchSize = SCAN_STRATEGIES[strategy].threads;
    let done = 0;
    const found = [];

    for (let i = 0; i < hosts.length; i += batchSize) {
      if (abortRef.current) break;
      const batch = hosts.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((ip) =>
          simulateScan(ip, strategy, (stage) => {
            setCurrentStage(stage);
            setCurrentIP(ip);
          })
        )
      );
      results.forEach((r, bi) => {
        const ip = batch[bi];
        done++;
        if (r) {
          found.push(r);
          setDevices((prev) => [...prev, r]);
          appendLog(`[+] ${ip}  ${r.brand} ${r.model}  ports: ${r.openPorts.join(",")}  RTSP: ${r.rtspStatus}`, "found");
        }
      });
      setScanned(done);
      setProgress(Math.round((done / hosts.length) * 100));
      // Tiny breather so React can paint
      await new Promise((r) => setTimeout(r, 0));
    }

    setScanning(false);
    setCurrentStage(null);
    appendLog(`Scan complete. ${found.length} NVR device(s) found across ${done} hosts.`, "done");
    if (found.length > 0) setTab("results");
  }, [cidr, strategy, appendLog]);

  const stopScan = () => { abortRef.current = true; };

  const registerDevice = useCallback((id) => {
    setDevices((prev) =>
      prev.map((d) => d.id === id ? { ...d, registeredToSangati: true } : d)
    );
    appendLog(`Device ${id.slice(-8)} registered to Sangati VMS at ${sangatiEndpoint}`, "done");
  }, [sangatiEndpoint, appendLog]);

  const registerAll = () => {
    devices.forEach((d) => {
      if (!d.registeredToSangati) registerDevice(d.id);
    });
  };

  const exportJSON = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      cidr,
      strategy,
      totalHostsScanned: scanned,
      devicesFound: devices.length,
      devices: devices.map((d) => ({
        ...d,
        rtspPath: d.rtspPath,
        credentials: `vault://sangati/nvr-creds/${d.brand.toLowerCase().replace(/\//g, "-")}`,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sangati-nvr-scan-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pushToSangati = async () => {
    setPushStatus("pushing");
    await new Promise((r) => setTimeout(r, 1200));
    setPushStatus("success");
    setDevices((prev) => prev.map((d) => ({ ...d, registeredToSangati: true })));
    appendLog(`Bulk push complete — ${devices.length} device(s) registered to ${sangatiEndpoint}`, "done");
    setTimeout(() => setPushStatus(null), 3000);
  };

  // Auto-scroll log
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const tabs = [
    { id: "scanner",      label: "Scanner" },
    { id: "results",      label: `Results${devices.length ? ` (${devices.length})` : ""}` },
    { id: "integration",  label: "Sangati VMS" },
    { id: "architecture", label: "Pipeline" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100 font-sans">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/60 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-teal-500/20 border border-teal-600 flex items-center justify-center">
              <span className="text-teal-400 text-sm">⬡</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-wide">Sangati NVR Discovery Engine</h1>
              <p className="text-xs text-gray-500">Enterprise network scanner · VMS integration</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {devices.length > 0 && (
              <button
                onClick={exportJSON}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:border-teal-600 hover:text-teal-300 transition-colors"
              >
                Export JSON
              </button>
            )}
            <div className={`px-2.5 py-1 rounded-full text-xs border ${scanning ? "border-amber-600 text-amber-400 bg-amber-900/20 animate-pulse" : "border-gray-700 text-gray-500"}`}>
              {scanning ? "SCANNING" : "IDLE"}
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 flex gap-0 border-t border-gray-800/50">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm transition-colors border-b-2 ${
                tab === t.id
                  ? "border-teal-500 text-teal-300"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ── SCANNER TAB ── */}
        {tab === "scanner" && (
          <div className="space-y-5">
            {/* Config panel */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Network range */}
              <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Network Target</h2>
                <label className="text-xs text-gray-500 block mb-1">CIDR Range</label>
                <input
                  type="text"
                  value={cidr}
                  onChange={(e) => setCidr(e.target.value)}
                  disabled={scanning}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-teal-300 focus:outline-none focus:border-teal-600 disabled:opacity-50"
                  placeholder="192.168.1.0/24"
                />
                {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {["192.168.1.0/24", "10.0.0.0/24", "172.16.0.0/24"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setCidr(s)}
                      disabled={scanning}
                      className="px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-400 hover:border-teal-700 hover:text-teal-400 transition-colors disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Strategy */}
              <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Scan Strategy</h2>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(SCAN_STRATEGIES).map(([key, s]) => (
                    <button
                      key={key}
                      onClick={() => setStrategy(key)}
                      disabled={scanning}
                      className={`text-left p-3 rounded-lg border transition-all disabled:opacity-40 ${
                        strategy === key
                          ? "border-teal-600 bg-teal-900/20"
                          : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
                      }`}
                    >
                      <div className="text-xs font-semibold text-gray-200">{s.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
                      <div className="mt-1.5 flex gap-2">
                        <span className="text-xs font-mono text-gray-600">{s.threads}t</span>
                        <span className="text-xs font-mono text-gray-600">{s.timeout}ms</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Port targets */}
            <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">Target Ports</h2>
              <div className="flex flex-wrap gap-2">
                {COMMON_NVR_PORTS.map((p) => (
                  <div
                    key={p.port}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700"
                  >
                    <span className="text-xs font-mono text-teal-400">{p.port}</span>
                    <span className="text-xs text-gray-500">{p.protocol}</span>
                    <span className="text-xs text-gray-600">·</span>
                    <span className="text-xs text-gray-500">{p.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Scan controls */}
            <div className="flex gap-3 items-center">
              {!scanning ? (
                <button
                  onClick={startScan}
                  className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Start Scan
                </button>
              ) : (
                <button
                  onClick={stopScan}
                  className="px-6 py-2.5 bg-red-700 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Stop Scan
                </button>
              )}
              {devices.length > 0 && !scanning && (
                <button
                  onClick={() => setTab("results")}
                  className="px-4 py-2.5 border border-teal-700 text-teal-300 text-sm rounded-lg hover:bg-teal-900/20 transition-colors"
                >
                  View {devices.length} Device{devices.length !== 1 ? "s" : ""}
                </button>
              )}
            </div>

            {/* Progress */}
            {(scanning || scanned > 0) && (
              <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    {scanning ? "Scanning…" : "Scan complete"} — {scanned}/{total} hosts
                  </span>
                  <span className="font-mono text-teal-400">{progress}%</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {scanning && currentStage && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">
                      Current: <span className="font-mono text-gray-300">{currentIP}</span>
                    </p>
                    <StageIndicator stage={currentStage} />
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>Found: <span className="text-teal-400 font-semibold">{devices.length}</span></span>
                  <span>Threads: <span className="text-gray-400">{SCAN_STRATEGIES[strategy].threads}</span></span>
                  <span>Timeout: <span className="text-gray-400">{SCAN_STRATEGIES[strategy].timeout}ms</span></span>
                </div>
              </div>
            )}

            {/* Log */}
            {log.length > 0 && (
              <div className="rounded-xl border border-gray-700 bg-black/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 font-semibold">Discovery Log</span>
                  <span className="text-xs text-gray-600">{log.length} entries</span>
                </div>
                <div
                  ref={logRef}
                  className="h-48 overflow-y-auto space-y-0.5 font-mono text-xs"
                  style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}
                >
                  {log.map((entry, i) => (
                    <div key={i} className={`flex gap-2 leading-5 ${
                      entry.level === "found" ? "text-teal-400" :
                      entry.level === "done"  ? "text-green-400" :
                      entry.level === "error" ? "text-red-400"   :
                      "text-gray-500"
                    }`}>
                      <span className="text-gray-700 shrink-0">{entry.ts}</span>
                      <span>{entry.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── RESULTS TAB ── */}
        {tab === "results" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-200">Discovered Devices</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {devices.length} NVR device{devices.length !== 1 ? "s" : ""} found · Click a row to expand
                </p>
              </div>
              <div className="flex gap-2">
                {devices.some((d) => !d.registeredToSangati) && (
                  <button
                    onClick={registerAll}
                    className="px-3 py-1.5 text-xs rounded-lg bg-teal-700/40 border border-teal-600 text-teal-300 hover:bg-teal-600/50 transition-colors"
                  >
                    Register All
                  </button>
                )}
                <button
                  onClick={exportJSON}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:border-teal-600 hover:text-teal-300 transition-colors"
                >
                  Export JSON
                </button>
              </div>
            </div>

            {devices.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
                <p className="text-gray-500 text-sm">No devices discovered yet.</p>
                <button
                  onClick={() => setTab("scanner")}
                  className="mt-3 text-xs text-teal-400 hover:underline"
                >
                  Run a scan →
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-700 bg-gray-900/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-700 bg-gray-800/60 text-xs text-gray-500">
                        <th className="text-left py-2.5 px-3">IP Address</th>
                        <th className="text-left py-2.5 px-3">Brand</th>
                        <th className="text-left py-2.5 px-3">Model</th>
                        <th className="text-left py-2.5 px-3">Open Ports</th>
                        <th className="text-left py-2.5 px-3">RTSP</th>
                        <th className="text-left py-2.5 px-3">ONVIF</th>
                        <th className="text-left py-2.5 px-3">Sangati</th>
                        <th className="py-2.5 px-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.map((d) => (
                        <DeviceRow key={d.id} device={d} onRegister={registerDevice} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Brand summary */}
            {devices.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(
                  devices.reduce((acc, d) => { acc[d.brand] = (acc[d.brand] || 0) + 1; return acc; }, {})
                ).map(([brand, count]) => (
                  <div key={brand} className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                    <p className="text-xs text-gray-500">{brand}</p>
                    <p className="text-2xl font-bold text-teal-400 mt-0.5">{count}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── INTEGRATION TAB ── */}
        {tab === "integration" && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-gray-200">Sangati VMS Integration</h2>
              <p className="text-xs text-gray-500 mt-0.5">Register discovered devices to Sangati Video Management System</p>
            </div>

            {/* Endpoint config */}
            <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-300">Connection Settings</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Sangati API Endpoint</label>
                  <input
                    type="text"
                    value={sangatiEndpoint}
                    onChange={(e) => setSangatiEndpoint(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-300 focus:outline-none focus:border-teal-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Service Token</label>
                  <input
                    type="password"
                    value={sangatiToken}
                    onChange={(e) => setSangatiToken(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-300 focus:outline-none focus:border-teal-600"
                    placeholder="sangati_svc_..."
                  />
                </div>
              </div>
              <div className="text-xs text-gray-500 font-mono bg-gray-800/60 rounded-lg p-3 border border-gray-700/50">
                POST {sangatiEndpoint}/api/v2/devices/register<br />
                Authorization: Bearer [token]<br />
                Content-Type: application/json
              </div>
            </div>

            {/* Registration summary */}
            <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Registration Status</h3>
              {devices.length === 0 ? (
                <p className="text-sm text-gray-500">No devices discovered. Run a scan first.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="rounded-lg bg-gray-800/60 border border-gray-700 p-3 text-center">
                      <p className="text-2xl font-bold text-gray-200">{devices.length}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Discovered</p>
                    </div>
                    <div className="rounded-lg bg-teal-900/30 border border-teal-700/50 p-3 text-center">
                      <p className="text-2xl font-bold text-teal-400">{devices.filter((d) => d.registeredToSangati).length}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Registered</p>
                    </div>
                    <div className="rounded-lg bg-amber-900/20 border border-amber-700/50 p-3 text-center">
                      <p className="text-2xl font-bold text-amber-400">{devices.filter((d) => !d.registeredToSangati).length}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Pending</p>
                    </div>
                  </div>
                  <button
                    onClick={pushToSangati}
                    disabled={pushStatus === "pushing" || devices.every((d) => d.registeredToSangati)}
                    className="w-full py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                  >
                    {pushStatus === "pushing"
                      ? "Pushing to Sangati…"
                      : pushStatus === "success"
                      ? "All devices registered ✓"
                      : devices.every((d) => d.registeredToSangati)
                      ? "All devices already registered"
                      : `Push ${devices.filter((d) => !d.registeredToSangati).length} device(s) to Sangati VMS`}
                  </button>
                </>
              )}
            </div>

            {/* RTSP summary */}
            {devices.length > 0 && (
              <div className="rounded-xl border border-gray-700 bg-gray-900/60 p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">RTSP Stream Manifest</h3>
                <div className="space-y-2 max-h-72 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#374151 transparent" }}>
                  {devices.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 text-xs font-mono py-1.5 border-b border-gray-800/50">
                      <Badge label={d.rtspStatus} color={d.rtspStatus === "OK" ? "green" : "amber"} />
                      <span className="text-gray-500">{d.ip}</span>
                      <span className="text-teal-400 truncate">{d.rtspPath}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ARCHITECTURE TAB ── */}
        {tab === "architecture" && <ArchitectureDiagram />}
      </div>
    </div>
  );
}
