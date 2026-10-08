// cPanel "Setup Node.js App" startup file (Phusion Passenger).
// Application startup file in cPanel: app.js
//
// Environment variables: set them in the cPanel Node.js App screen, or put them in a ".env" file next to
// this file (permissions 600). Values set in cPanel win over .env.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

process.chdir(__dirname);
process.env.NODE_ENV = "production";
process.env.NEXT_TELEMETRY_DISABLED = "1";

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile); // Node ≥ 20.12 / 21.7 — never overrides variables already set
  } catch (e) {
    console.error("[startup] could not read .env:", e.message);
  }
}

// Passenger hands the app its own socket (listen() is intercepted); without Passenger (manual test)
// the server listens on 127.0.0.1:PORT only. cPanel sets HOSTNAME to the machine name — not wanted here.
process.env.HOSTNAME = process.env.BIND_HOST || "127.0.0.1";
process.env.PORT = process.env.PORT || "3000";

require("./server.js");
