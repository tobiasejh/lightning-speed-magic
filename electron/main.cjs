// Prism desktop shell. The built app is served over a local HTTP server rather
// than file:// so that browser storage (saved shows) and popup projector windows work.
const { app, BrowserWindow, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "dist-electron");

// Makes Electron use "Prism" everywhere (window title, log folder, userData
// folder) instead of the package.json "name" (tanstack_start_ts).
app.setName("Prism");

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      let file = path.join(root, decodeURIComponent(url.pathname));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(root, "index.html"); // client-side routing fallback
      }
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

let base = "";

function makeWindow(route, options = {}) {
  const win = new BrowserWindow({
    width: options.width ?? 1440,
    height: options.height ?? 900,
    backgroundColor: "#0b0d12",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // projector windows open as extra app windows
    if (url.startsWith(base)) {
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

app.whenReady().then(async () => {
  base = await startServer();
  const win = makeWindow("/");
  if (!fs.existsSync(path.join(root, "index.html"))) showMissingFiles(win);

  log.transports.file.level = "info";
  autoUpdater.logger = log;

  autoUpdater.on("checking-for-update", () => log.info("Checking for update..."));
  autoUpdater.on("update-available", (info) => log.info("Update available:", info.version));
  autoUpdater.on("update-not-available", (info) => log.info("No update available. Current:", info.version));
  autoUpdater.on("error", (err) => log.error("Updater error:", err));
  autoUpdater.on("download-progress", (p) => log.info(`Downloading: ${Math.round(p.percent)}%`));
  autoUpdater.on("update-downloaded", (info) => log.info("Update downloaded:", info.version));

  autoUpdater.checkForUpdatesAndNotify();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) makeWindow("/");
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});