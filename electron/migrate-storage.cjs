// One-time rescue of shows saved by older Prism builds.
//
// Older builds served the app from http://127.0.0.1:<random port>. Browser storage belongs
// to an origin *including the port*, so every launch got its own, empty IndexedDB and the
// shows saved before were out of reach (each sits in IndexedDB/http_127.0.0.1_<port>...).
// The app now lives at a fixed origin (app://prism). For every old folder we briefly serve
// that exact old origin again, read its shows in a hidden window, and write them into the
// new origin's database. The old folders are never modified or deleted.
const { app, BrowserWindow } = require("electron");
const log = require("electron-log");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const OLD_FOLDER = /^http_127\.0\.0\.1_(\d+)\.indexeddb\.leveldb$/;
const STEP_TIMEOUT_MS = 5 * 60 * 1000;
const MIGRATION_PATH = "/__migration/";

/** Set while the import window runs; served by the app:// handler in main.cjs. */
let pending = null;

const withTimeout = (promise, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out`)), STEP_TIMEOUT_MS),
    ),
  ]);

// Runs inside the old origin. Reads the "prism" database (same layout as src/lib/store.ts)
// and uploads it to the temporary server that serves this origin.
const EXPORT_SCRIPT = (token) => `(async () => {
  const names = (await indexedDB.databases()).map((d) => d.name);
  if (!names.includes("prism")) return { projects: 0, blobs: 0 };
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("prism");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const getAll = (store) =>
    new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(store)) return resolve([]);
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const projects = await getAll("projects");
  const blobs = await getAll("blobs");
  db.close();
  const headers = { "x-prism-token": ${JSON.stringify(token)} };
  let n = 0;
  for (const b of blobs) {
    const query = new URLSearchParams({
      n: String(n++),
      id: String(b.id),
      projectId: String(b.projectId),
      name: String(b.name ?? b.id),
      type: String(b.type || (b.blob && b.blob.type) || ""),
    });
    const r = await fetch("/__blob?" + query, { method: "POST", headers, body: b.blob });
    if (!r.ok) throw new Error("could not copy file " + b.id);
  }
  const r = await fetch("/__projects", { method: "POST", headers, body: JSON.stringify(projects) });
  if (!r.ok) throw new Error("could not copy projects");
  return { projects: projects.length, blobs: blobs.length };
})()`;

// Runs inside app://prism. Writes the collected shows into the new database. A show that
// already exists there is only replaced by a newer copy.
const IMPORT_SCRIPT = `(async () => {
  const manifest = await (await fetch("${MIGRATION_PATH}manifest.json")).json();
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("prism", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("projects"))
        d.createObjectStore("projects", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const request = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const finished = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  let imported = 0;
  let skipped = 0;
  let newest = null;
  for (const project of manifest.projects) {
    const existing = await request(
      db.transaction("projects").objectStore("projects").get(project.id),
    );
    if (existing && existing.updatedAt >= project.updatedAt) {
      skipped++;
      continue;
    }
    // fetch first: an IndexedDB transaction closes as soon as we await anything else
    const records = [];
    for (const b of manifest.blobs.filter((item) => item.projectId === project.id)) {
      const r = await fetch("${MIGRATION_PATH}blob/" + b.n);
      if (!r.ok) throw new Error("missing file " + b.id);
      const blob = new Blob([await r.blob()], { type: b.type });
      records.push({ id: b.id, projectId: b.projectId, blob, name: b.name, type: b.type });
    }
    const tx = db.transaction(["projects", "blobs"], "readwrite");
    tx.objectStore("projects").put(project);
    for (const record of records) tx.objectStore("blobs").put(record);
    await finished(tx);
    imported++;
    if (!newest || project.updatedAt > newest.updatedAt) newest = project;
  }
  db.close();
  // reopen the most recent rescued show, like the app does after a normal restart
  if (newest && !localStorage.getItem("prism:lastProject"))
    localStorage.setItem("prism:lastProject", newest.id);
  return { imported, skipped };
})()`;

function hiddenWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
}

/** Serve the old origin on its old port and copy its shows into `dir`. */
async function exportFromPort(port, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const token = crypto.randomUUID();
  const blobs = [];
  let projects = null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const fail = (status) => {
      res.statusCode = status;
      res.end();
    };
    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Prism</title>");
      return;
    }
    if (req.headers["x-prism-token"] !== token) return fail(403);
    if (req.method === "POST" && url.pathname === "/__blob") {
      const n = Number(url.searchParams.get("n"));
      if (!Number.isInteger(n) || n < 0) return fail(400);
      const file = path.join(dir, `blob-${n}`);
      pipeline(req, fs.createWriteStream(file)).then(
        () => {
          blobs.push({
            n,
            id: url.searchParams.get("id"),
            projectId: url.searchParams.get("projectId"),
            name: url.searchParams.get("name"),
            type: url.searchParams.get("type") ?? "",
            file,
          });
          res.end("ok");
        },
        () => fail(500),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/__projects") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          projects = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          res.end("ok");
        } catch {
          fail(400);
        }
      });
      return;
    }
    fail(404);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const win = hiddenWindow();
  try {
    await withTimeout(win.loadURL(`http://127.0.0.1:${port}/`), `opening port ${port}`);
    const counts = await withTimeout(
      win.webContents.executeJavaScript(EXPORT_SCRIPT(token)),
      `reading port ${port}`,
    );
    log.info(`[migration] port ${port}: ${counts.projects} shows, ${counts.blobs} files`);
    return { projects: projects ?? [], blobs };
  } finally {
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Newest copy of each show wins; its files come from the same old database. */
function merge(exports) {
  const chosen = new Map();
  for (const ex of exports) {
    for (const project of ex.projects) {
      const current = chosen.get(project.id);
      if (!current || project.updatedAt > current.project.updatedAt)
        chosen.set(project.id, { project, from: ex });
    }
  }
  const projects = [];
  const blobs = [];
  for (const { project, from } of chosen.values()) {
    projects.push(project);
    for (const b of from.blobs) {
      if (b.projectId === project.id) blobs.push({ ...b, n: blobs.length });
    }
  }
  return { projects, blobs };
}

/**
 * Answers app://prism/__migration/... while the import runs, otherwise null.
 * Called by the app:// protocol handler in main.cjs.
 */
function handleMigrationRequest(pathname) {
  if (!pending || !pathname.startsWith(MIGRATION_PATH)) return null;
  const rest = pathname.slice(MIGRATION_PATH.length);
  if (rest === "") {
    return new Response("<!doctype html><title>Prism</title>", {
      headers: { "content-type": "text/html" },
    });
  }
  if (rest === "manifest.json") {
    const { projects, blobs } = pending;
    const list = blobs.map(({ n, id, projectId, name, type }) => ({
      n,
      id,
      projectId,
      name,
      type,
    }));
    return Response.json({ projects, blobs: list });
  }
  const match = /^blob\/(\d+)$/.exec(rest);
  const blob = match ? pending.blobs[Number(match[1])] : undefined;
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(fs.createReadStream(blob.file)), {
    headers: { "content-type": blob.type || "application/octet-stream" },
  });
}

/**
 * Copy shows from every old http://127.0.0.1:<port> origin into `base` (app://prism).
 * Safe to call on every launch: finished ports are remembered and skipped.
 */
async function migrateOldStorage(base) {
  const userData = app.getPath("userData");
  const idbDir = path.join(userData, "IndexedDB");
  const stateFile = path.join(userData, "storage-migration.json");
  if (!fs.existsSync(idbDir)) return;

  let done = [];
  try {
    done = JSON.parse(fs.readFileSync(stateFile, "utf8")).done ?? [];
  } catch {
    /* first run */
  }
  const ports = fs
    .readdirSync(idbDir)
    .map((name) => OLD_FOLDER.exec(name)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter((port) => !done.includes(port));
  if (!ports.length) return;

  log.info(`[migration] copying shows from ${ports.length} old storage folder(s)`);
  const staging = path.join(userData, "storage-migration-tmp");
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    const exports = [];
    const exported = [];
    for (const port of ports) {
      try {
        exports.push(await exportFromPort(port, path.join(staging, String(port))));
        exported.push(port);
      } catch (error) {
        // e.g. the port is taken by another program right now: try again next launch
        log.warn(`[migration] port ${port} skipped:`, error);
      }
    }
    if (!exported.length) return;

    pending = merge(exports);
    const win = hiddenWindow();
    try {
      await withTimeout(win.loadURL(`${base}${MIGRATION_PATH}`), "opening app storage");
      const result = await withTimeout(
        win.webContents.executeJavaScript(IMPORT_SCRIPT),
        "writing app storage",
      );
      log.info(`[migration] ${result.imported} shows copied, ${result.skipped} already present`);
    } finally {
      win.destroy();
      pending = null;
    }
    fs.writeFileSync(stateFile, JSON.stringify({ done: [...done, ...exported] }, null, 2));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { migrateOldStorage, handleMigrationRequest };
