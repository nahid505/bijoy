// cPanel "Setup Node.js App" startup file — for an app BUILT ON THE SERVER (git clone → npm ci → npm run build).
//   Application startup file: server.js
//
// It starts the Next.js standalone server in .next/standalone (output: "standalone" in next.config.ts),
// after copying the static files and public/ next to it the first time (the standalone build leaves them out).
//
// Uploading the ready-made package instead (npm run deploy:cpanel → deploy.tar.gz)? That package has its own
// startup file, app.js — use that, not this one. See deploy-guide.md.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const standalone = path.join(root, ".next", "standalone");
const entry = path.join(standalone, "server.js");

if (!fs.existsSync(entry)) {
  console.error("[startup] .next/standalone/server.js not found — run `npm run build` first (next.config.ts must keep output: \"standalone\").");
  process.exit(1);
}

// .next/static and public/ are served by the standalone server only from inside its own folder
const syncDir = (from, to) => {
  if (!fs.existsSync(from)) return;
  const stamp = (p) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0);
  if (fs.existsSync(to) && stamp(to) >= stamp(from)) return; // already copied for this build
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
};
syncDir(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
syncDir(path.join(root, "public"), path.join(standalone, "public"));

process.env.NODE_ENV = "production";
process.env.NEXT_TELEMETRY_DISABLED = "1";
// environment: cPanel's Node.js App variables win; a .env next to this file fills the rest (permissions 600)
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile); // Node ≥ 20.12 — never overrides variables already set
  } catch (e) {
    console.error("[startup] could not read .env:", e.message);
  }
}
// Passenger hands the app its own socket; without Passenger (manual test) listen on 127.0.0.1:PORT.
// cPanel sets HOSTNAME to the machine name — not what the server should bind to.
process.env.HOSTNAME = process.env.BIND_HOST || "127.0.0.1";
process.env.PORT = process.env.PORT || "3000";

require(entry);
