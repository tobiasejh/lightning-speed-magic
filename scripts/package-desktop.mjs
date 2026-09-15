// Builds the desktop screens, stages a minimal Electron app folder, packages it
// for Windows and verifies the screens really made it into the bundle.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const stage = "/tmp/prism-app";
const outDir = path.join(root, "electron-release");

function run(cmd, args, cwd = root) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

// 1. build the renderer
run("npx", ["vite", "build", "--config", "vite.electron.config.ts"]);

const built = path.join(root, "dist-electron");
if (!fs.existsSync(path.join(built, "index.html"))) {
  throw new Error("dist-electron/index.html missing after build");
}

// 2. stage only what the app needs
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "electron"), { recursive: true });
fs.cpSync(built, path.join(stage, "dist-electron"), { recursive: true });
fs.cpSync(path.join(root, "electron", "main.cjs"), path.join(stage, "electron", "main.cjs"));
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify({ name: "prism", productName: "Prism", version: "8.0.0", main: "electron/main.cjs" }, null, 2),
);

// 3. package for Windows
fs.rmSync(outDir, { recursive: true, force: true });
run(
  "npx",
  [
    "@electron/packager",
    stage,
    "Prism",
    "--platform=win32",
    "--arch=x64",
    "--asar",
    "--overwrite",
    `--out=${outDir}`,
    `--electron-version=${JSON.parse(fs.readFileSync(path.join(root, "node_modules/electron/package.json"), "utf8")).version}`,
  ],
  stage,
);

// 4. verify the screens are inside the packaged bundle
const asar = path.join(outDir, "Prism-win32-x64", "resources", "app.asar");
const listing = execFileSync("npx", ["asar", "list", asar], { cwd: root, encoding: "utf8" });
if (!listing.includes("dist-electron") || !listing.includes("index.html")) {
  throw new Error("packaged app.asar does not contain dist-electron/index.html");
}
console.log("packaged OK:", asar);
