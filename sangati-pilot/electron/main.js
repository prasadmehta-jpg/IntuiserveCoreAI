const {
  app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog,
} = require('electron');
const { spawn, execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const os    = require('os');

// ── Paths ───────────────────────────────────────────────────
const IS_DEV   = !app.isPackaged;
const APP_ROOT = IS_DEV
  ? path.resolve(__dirname, '..')
  : path.resolve(process.resourcesPath, 'app');

const userData     = app.getPath('userData');
const DATABASE_PATH = path.join(userData, 'sangati.db');
const LOG_PATH      = path.join(userData, 'sangati.log');

const PORTS = { api: 3847, web: 3000, vision: 3849 };

// ── State ───────────────────────────────────────────────────
let splashWindow  = null;
let mainWindow    = null;
let tray          = null;
let apiProcess    = null;
let webProcess    = null;
let visionProcess = null;
let apiRestarts   = 0;
let isQuitting    = false;
let systemNodePath = null;

// ── Logging ─────────────────────────────────────────────────
function log(line) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${line}\n`;
  try { fs.appendFileSync(LOG_PATH, entry); } catch {}
  if (IS_DEV) process.stdout.write(entry);
}

// ── Node/pnpm discovery ─────────────────────────────────────
function findNode() {
  const candidates = [
    // Same dir as Electron binary (bundled node)
    process.execPath.replace(/electron\.exe$/i, 'node.exe').replace(/SANGATI\.exe$/i, 'node.exe'),
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(os.homedir(), 'AppData\\Roaming\\nvm\\current\\node.exe'),
    path.join(os.homedir(), 'AppData\\Local\\Programs\\nodejs\\node.exe'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  // Fall back to PATH
  try {
    const result = execSync('where node', { encoding: 'utf8', timeout: 5000 }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch {}
  return null;
}

function findPnpm() {
  try {
    const result = execSync('where pnpm', { encoding: 'utf8', timeout: 5000 }).trim().split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch {}
  const p = path.join(os.homedir(), 'AppData\\Roaming\\npm\\pnpm.cmd');
  if (fs.existsSync(p)) return p;
  return null;
}

// Locate tsx.cmd inside the app's node_modules — avoids npx resolving it as a JS file
function findTsx(appRoot) {
  const candidates = [
    path.join(appRoot, 'node_modules', '.bin', 'tsx.cmd'),
    path.join(appRoot, 'node_modules', '.bin', 'tsx'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Returns process.env with Node.js dir injected into PATH
function getEnrichedEnv(nodePath) {
  const nodeDir = nodePath ? path.dirname(nodePath) : 'C:\\Program Files\\nodejs';
  const currentPath = process.env.PATH || '';
  const alreadyPresent = currentPath.split(';').some(p => p.toLowerCase() === nodeDir.toLowerCase());
  return {
    ...process.env,
    PATH: alreadyPresent ? currentPath : `${nodeDir};${currentPath}`,
  };
}

// ── Node version check ─────────────────────────────────────
function checkNodeVersion() {
  const nodePath = findNode();
  if (!nodePath) {
    return { ok: false, version: null, error: 'Node.js not found. Install Node.js 22+ from nodejs.org' };
  }
  try {
    const enrichedEnv = getEnrichedEnv(nodePath);
    const ver = execSync(`"${nodePath}" --version`, { encoding: 'utf8', timeout: 5000, env: enrichedEnv }).trim();
    const major = parseInt(ver.replace('v', '').split('.')[0], 10);
    if (major < 22) {
      return { ok: false, version: ver, error: `Node.js 22+ required (found ${ver})` };
    }
    return { ok: true, version: ver, path: nodePath };
  } catch (e) {
    return { ok: false, version: null, error: `Node.js check failed: ${e.message}` };
  }
}

// ── Local IP ────────────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

// ── Port cleanup ────────────────────────────────────────────
function killPortProcesses() {
  // On Windows, find and kill any processes using our ports before startup
  if (process.platform !== 'win32') return;
  for (const port of [PORTS.api, PORTS.web, PORTS.vision]) {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 5000 });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const match = line.trim().match(/LISTENING\s+(\d+)/);
        if (match && match[1] !== '0') pids.add(match[1]);
      }
      for (const pid of pids) {
        log(`Killing existing process on port ${port}: PID ${pid}`);
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 }); } catch {}
      }
    } catch {} // no process on this port
  }
}

// ── HTTP health poll ────────────────────────────────────────
function pollHttp(url, intervalMs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let timer = null;

    function attempt() {
      if (Date.now() > deadline) {
        clearTimeout(timer);
        return reject(new Error(`Timeout waiting for ${url}`));
      }
      const req = http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          res.resume();
          clearTimeout(timer);
          return resolve();
        }
        res.resume();
        timer = setTimeout(attempt, intervalMs);
      });
      req.on('error', () => {
        timer = setTimeout(attempt, intervalMs);
      });
      req.setTimeout(2000, () => req.destroy());
    }

    attempt();
  });
}

// ── Splash ──────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480, height: 360,
    frame: false, resizable: false,
    transparent: false,
    backgroundColor: '#0B1426',
    show: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function setSplashStatus(msg) {
  log(msg);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('status', msg);
  }
}

function showSplashError(msg) {
  log(`ERROR: ${msg}`);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('error', msg);
  }
}

// ── Child process helpers ───────────────────────────────────
function pipeToLog(proc, label) {
  if (proc.stdout) proc.stdout.on('data', (d) => log(`[${label}] ${d.toString().trimEnd()}`));
  if (proc.stderr) proc.stderr.on('data', (d) => log(`[${label}:err] ${d.toString().trimEnd()}`));
}

function spawnCmd(command, args, options) {
  // On Windows, .cmd/.bat scripts must be spawned with shell: true.
  // When shell:true, cmd.exe receives the command as a raw string and splits
  // on spaces — so any path containing spaces must be double-quoted.
  const isWin = process.platform === 'win32';
  const cmd = (isWin && command.includes(' ')) ? `"${command}"` : command;
  return spawn(cmd, args, { ...options, shell: isWin });
}

function spawnApi() {
  const entry = path.join('apps', 'api', 'src', 'index.ts');
  const tsxCmd = findTsx(APP_ROOT) || 'npx';
  const tsxArgs = tsxCmd === 'npx' ? ['tsx', entry] : [entry];

  log(`Spawning API: ${tsxCmd} ${tsxArgs.join(' ')}`);

  apiProcess = spawnCmd(tsxCmd, tsxArgs, {
    cwd: APP_ROOT,
    env: {
      ...getEnrichedEnv(systemNodePath),
      DATABASE_PATH,
      API_PORT:  String(PORTS.api),
      API_HOST:  '127.0.0.1',
      NODE_ENV:  'production',
      DAILY_REVENUE_TARGET: process.env.DAILY_REVENUE_TARGET || '50000',
      NEXT_PUBLIC_API_URL: `http://localhost:${PORTS.api}`,
      NEXT_PUBLIC_WS_URL:  `ws://localhost:${PORTS.api}`,
      VISION_SERVICE_URL:  `http://localhost:${PORTS.vision}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  pipeToLog(apiProcess, 'api');

  apiProcess.on('exit', (code, signal) => {
    log(`API exited: code=${code} signal=${signal}`);
    if (!isQuitting && apiRestarts < 3) {
      apiRestarts++;
      log(`Restarting API (attempt ${apiRestarts}/3) in 2s…`);
      setTimeout(() => spawnApi(), 2000);
    }
  });

  return apiProcess;
}

function spawnWeb() {
  const webDir  = path.join(APP_ROOT, 'apps', 'web');

  // Standalone build: self-contained server with all deps resolved
  const standaloneServer = path.join(webDir, '.next', 'standalone', 'apps', 'web', 'server.js');
  const hasStandalone = fs.existsSync(standaloneServer);

  // Static assets must be copied for standalone mode
  if (hasStandalone) {
    const staticSrc  = path.join(webDir, '.next', 'static');
    const staticDest = path.join(webDir, '.next', 'standalone', 'apps', 'web', '.next', 'static');
    const publicSrc  = path.join(webDir, 'public');
    const publicDest = path.join(webDir, '.next', 'standalone', 'apps', 'web', 'public');
    try {
      if (fs.existsSync(staticSrc)) {
        fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
      }
      if (fs.existsSync(publicSrc)) {
        fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
      }
    } catch (e) { log(`Static copy warning: ${e.message}`); }
  }

  if (hasStandalone) {
    const nodeExe = systemNodePath || 'node';
    log(`Spawning Web (standalone): ${nodeExe} ${standaloneServer}`);
    webProcess = spawnCmd(nodeExe, [standaloneServer], {
      cwd: path.dirname(standaloneServer),
      env: {
        ...getEnrichedEnv(systemNodePath),
        PORT: String(PORTS.web),
        HOSTNAME: '0.0.0.0',
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: `http://localhost:${PORTS.api}`,
        NEXT_PUBLIC_WS_URL:  `ws://localhost:${PORTS.api}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } else if (!IS_DEV) {
    // Packaged exe: standalone build is required — show a clear error rather than
    // attempting next dev, which would fail silently and produce a localhost error.
    const missing = standaloneServer;
    log(`ERROR: Standalone web build not found at ${missing}`);
    throw new Error(
      'Web interface build is missing. Please reinstall SANGATI or contact support.\n' +
      `(Expected: ${missing})`
    );
  } else {
    // Development fallback: run next dev so engineers can iterate without a full build
    log(`Spawning Web (next dev): npx next dev -p ${PORTS.web}`);
    webProcess = spawnCmd('npx', ['next', 'dev', '-p', String(PORTS.web)], {
      cwd: webDir,
      env: {
        ...getEnrichedEnv(systemNodePath),
        NODE_ENV: 'development',
        NEXT_PUBLIC_API_URL: `http://localhost:${PORTS.api}`,
        NEXT_PUBLIC_WS_URL:  `ws://localhost:${PORTS.api}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }
  pipeToLog(webProcess, 'web');

  webProcess.on('exit', (code, signal) => {
    log(`Web exited: code=${code} signal=${signal}`);
  });

  return webProcess;
}

function tryStartVision() {
  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const visionDir = path.join(APP_ROOT, 'agents', 'vision');

    if (!fs.existsSync(path.join(visionDir, 'main.py'))) {
      log('Vision: main.py not found, skipping');
      return null;
    }

    visionProcess = spawn(pythonCmd, ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', String(PORTS.vision)], {
      cwd: visionDir,
      env: { ...process.env, VISION_PORT: String(PORTS.vision) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    pipeToLog(visionProcess, 'vision');

    visionProcess.on('error', (err) => {
      log(`Vision spawn error (non-fatal): ${err.message}`);
      visionProcess = null;
    });

    visionProcess.on('exit', (code) => {
      log(`Vision exited: code=${code}`);
      visionProcess = null;
    });

    return visionProcess;
  } catch (e) {
    log(`Vision: Python not available (${e.message}), skipping`);
    return null;
  }
}

// ── Process cleanup ─────────────────────────────────────────
function killProcess(proc, name) {
  return new Promise((resolve) => {
    if (!proc || proc.killed) return resolve();
    log(`Killing ${name}…`);

    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };

    proc.on('exit', done);

    // On Windows, use taskkill for tree kill
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      } catch {}
      setTimeout(done, 1000);
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        done();
      }, 3000);
    }
  });
}

async function killAll() {
  await Promise.all([
    killProcess(apiProcess, 'API'),
    killProcess(webProcess, 'Web'),
    killProcess(visionProcess, 'Vision'),
  ]);
}

// ── Main window ─────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820,
    minWidth: 900, minHeight: 600,
    show: false,
    title: 'SANGATI — Restaurant Intelligence',
    icon: path.join(__dirname, '..', 'resources', 'icon.ico'),
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORTS.web}/manager`);

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

// ── System tray ─────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'resources', 'tray.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('SANGATI — Running');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: 'separator' },
    {
      label: 'Open Logs',
      click: () => shell.openPath(LOG_PATH),
    },
    { type: 'separator' },
    {
      label: 'Quit SANGATI',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ── Startup orchestration ───────────────────────────────────
async function startup() {
  try {
    createSplash();

    // Send local IP to splash
    const localIP = getLocalIP();
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.once('did-finish-load', () => {
        splashWindow.webContents.send('local-ip', localIP);
      });
    }

    // 0. Clean up any stale processes on our ports
    killPortProcesses();

    // 1. Check system Node version
    setSplashStatus('Checking system requirements…');
    const nodeInfo = checkNodeVersion();
    if (!nodeInfo.ok) {
      showSplashError(nodeInfo.error);
      return;
    }
    systemNodePath = nodeInfo.path;
    log(`System Node: ${nodeInfo.version} at ${nodeInfo.path}`);

    // 2. Run migrations
    setSplashStatus('Starting database…');
    try {
      const enrichedEnv = getEnrichedEnv(systemNodePath);
      const tsxCmd = findTsx(APP_ROOT);
      const migrateCmd = tsxCmd
        ? `"${tsxCmd}" scripts/migrate.ts`
        : 'npx tsx scripts/migrate.ts';
      log(`Running migrations: ${migrateCmd}`);
      execSync(migrateCmd, {
        cwd: APP_ROOT,
        env: { ...enrichedEnv, DATABASE_PATH },
        timeout: 30000,
        stdio: 'pipe',
        shell: true,
        windowsHide: true,
      });
      log('Migrations complete');
    } catch (e) {
      log(`Migration error: ${e.message}`);
      // Non-fatal — DB might already be set up
    }

    // 3. Start API
    setSplashStatus('Starting SANGATI engine…');
    spawnApi();

    // 4. Wait for API health (non-fatal — web loads regardless)
    setSplashStatus('Starting interface…');
    try {
      await pollHttp(`http://localhost:${PORTS.api}/health`, 500, 60000);
      log('API healthy');
    } catch (e) {
      log(`API did not respond in time — continuing startup (${e.message})`);
    }

    // 5. Start Web
    spawnWeb();

    // 6. Wait for Web
    await pollHttp(`http://localhost:${PORTS.web}`, 500, 30000);
    log('Web healthy');

    // 7. Vision (non-blocking)
    setSplashStatus('Launching…');
    tryStartVision();

    // 8. Create main window
    createMainWindow();

    mainWindow.once('ready-to-show', () => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      mainWindow.show();
      mainWindow.focus();
    });

    // 9. System tray
    createTray();

    // Send local IP to splash one more time (in case it loaded after the first send)
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('local-ip', localIP);
    }

  } catch (err) {
    log(`Startup failed: ${err.message}\n${err.stack}`);
    showSplashError(`Failed to start: ${err.message}`);
  }
}

// ── IPC handlers ────────────────────────────────────────────
ipcMain.handle('get-local-ip', () => getLocalIP());
ipcMain.handle('get-ports', () => PORTS);
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('open-logs', () => shell.openPath(LOG_PATH));

ipcMain.handle('scan-cameras', async () => {
  try {
    const res = await fetch(`http://localhost:${PORTS.api}/api/cameras/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('check-vision', async () => {
  try {
    const res = await fetch(`http://localhost:${PORTS.vision}/health`);
    return await res.json();
  } catch {
    return { ok: false, error: 'Vision service not running' };
  }
});

// Splash retry
ipcMain.on('retry-startup', () => {
  log('Retry requested from splash');
  apiRestarts = 0;
  killAll().then(() => startup());
});

ipcMain.on('open-logs-from-splash', () => {
  shell.openPath(LOG_PATH);
});

// ── App lifecycle ───────────────────────────────────────────
app.whenReady().then(startup);

app.on('window-all-closed', () => {
  // Do not quit — tray keeps app alive
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', async (e) => {
  e.preventDefault();
  await killAll();
  app.exit(0);
});

// Prevent second instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
