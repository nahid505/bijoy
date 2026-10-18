// File check after upload — run in the cPanel Terminal from the application root:
//   node check-files.cjs
//
// Compares every file with SHA256SUMS.txt (written by `npm run deploy:cpanel`). A file the hosting
// antivirus (ImunifyAV / ClamAV) quarantined, deleted or emptied shows up here by name, so it can be
// restored / whitelisted instead of guessing why the app does not start.
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");

process.chdir(__dirname);
const list = "SHA256SUMS.txt";
if (!fs.existsSync(list)) {
  console.error(`✖ ${list} not found — upload the whole package (it is created by npm run deploy:cpanel).`);
  process.exit(1);
}
const missing = [];
const changed = [];
let checked = 0;
for (const line of fs.readFileSync(list, "utf8").split(/\r?\n/)) {
  const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trim());
  if (!m) continue;
  const [, sum, rel] = m;
  checked++;
  if (!fs.existsSync(rel)) {
    missing.push(rel);
    continue;
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(rel)).digest("hex");
  if (actual !== sum) changed.push(rel);
}
console.log(`${checked} files checked`);
if (missing.length) console.log(`✖ missing (${missing.length}):\n  ${missing.slice(0, 50).join("\n  ")}`);
if (changed.length) console.log(`✖ changed / emptied (${changed.length}):\n  ${changed.slice(0, 50).join("\n  ")}`);
if (missing.length || changed.length) {
  console.log("\nLikely the hosting antivirus. cPanel → ImunifyAV (or \"Virus Scanner\") → restore / mark these as false positive,");
  console.log("or ask the host's support to whitelist them; then extract the package again.");
  process.exit(1);
}
console.log("✔ every file is present and unchanged");
