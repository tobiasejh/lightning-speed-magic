// Prism desktop shell. The built app is served from a fixed custom origin, app://prism,
// rather than file:// so that browser storage (saved shows) and popup projector windows work.
// The origin must never change between launches: IndexedDB and localStorage belong to it.
const { app, BrowserWindow, net, protocol, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { handleMigrationRequest, migrateOldStorage } = require("./migrate-storage.cjs");

const root = path.join(__dirname, "..", "dist-electron");

// Makes Electron use "Prism" everywhere (window title, log folder, userData
// folder) instead of the package.json "name" (tanstack_start_ts).
app.setName("Prism");

const SCHEME = "app";
const HOST = "prism";
const base = `${SCHEME}://${HOST}`;

// Must run before the app is ready. "standard" + "secure" give app://prism a real origin
// with IndexedDB, localStorage and secure-context APIs such as the microphone.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** A file inside the build folder for this path; anything else gets index.html (client routing). */
function resolveFile(pathname) {
  let decoded = "/";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* malformed escape: fall back to the app */
  }
  const file = path.join(root, decoded);
  const relative = path.relative(root, file);
  const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (inside && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  return path.join(root, "index.html");
}

function serveApp() {
  protocol.handle(SCHEME, (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== HOST) return new Response("Not found", { status: 404 });
    return handleMigrationRequest(pathname) ?? net.fetch(pathToFileURL(resolveFile(pathname)).href);
  });
}

let mainWindow = null;

function makeWindow(route, options = {}) {
  const win = new BrowserWindow({
    width: options.width ?? 1440,
    height: options.height ?? 900,
    backgroundColor: "#0b0d12",
    autoHideMenuBar: true,
    // Projector windows sit behind or beside the editor. With throttling on, Chromium slows
    // their timers and animation frames when they are hidden or covered, which breaks
    // video sync and makes playback stutter.
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // projector windows open as extra app windows
    if (url === base || url.startsWith(`${base}/`)) {
      const target = url.slice(base.length) || "/";
      makeWindow(target, { width: 960, height: 540 });
      return { action: "deny" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadURL(base + route);
  return win;
}

function showMissingFiles(win) {
  const message = `Prism could not find its app files.\n\nExpected: ${path.join(root, "index.html")}\n\nPlease re-download and unzip the whole folder, then run Prism.exe again.`;
  const page = `<body style="background:#0b0d12;color:#e6e8ef;font:14px system-ui;padding:32px;white-space:pre-wrap">${message}</body>`;
  void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
}

async function start() {
  serveApp();
  try {
    // shows saved by builds that used a random http://127.0.0.1 port; runs once per old folder
    await migrateOldStorage(base);
  } catch (error) {
    log.error("[migration] failed, will retry on next launch:", error);
  }
  mainWindow = makeWindow("/");
  if (!fs.existsSync(path.join(root, "index.html"))) showMissingFiles(mainWindow);

  log.transports.file.level = "info";
  autoUpdater.logger = log;

  // The default "github" provider resolves the latest release through
  // GitHub's releases Atom feed, which has a known intermittent 406 bug.
  // Pointing at GitHub's stable /releases/latest/download/ URL instead avoids
  // that broken lookup entirely, while still serving the exact same files.
  autoUpdater.setFeedURL({
    provider: "generic",
    url: "https://github.com/tobiasejh/lightning-speed-magic/releases/latest/download",
  });

  autoUpdater.on("checking-for-update", () => log.info("Checking for update..."));
  autoUpdater.on("update-available", (info) => log.info("Update available:", info.version));
  autoUpdater.on("update-not-available", (info) =>
    log.info("No update available. Current:", info.version),
  );
  autoUpdater.on("error", (err) => log.error("Updater error:", err));
  autoUpdater.on("download-progress", (p) => log.info(`Downloading: ${Math.round(p.percent)}%`));
  autoUpdater.on("update-downloaded", (info) => log.info("Update downloaded:", info.version));

  autoUpdater.checkForUpdatesAndNotify();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = makeWindow("/");
  });
}

// Two copies would share (and fight over) the same saved shows: keep one, focus it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

app.on("window-all-closed", () => {
  // the hidden migration windows close before the editor opens; that is not a quit
  if (!mainWindow) return;
  if (process.platform !== "darwin") app.quit();
});
