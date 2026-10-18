// One command for a small, clean cPanel / Recohost upload:
//
//   npm run deploy:cpanel                          MySQL / MariaDB build (cPanel "MySQL Databases")
//   npm run deploy:cpanel -- --db=postgresql       PostgreSQL build
//   npm run deploy:cpanel -- --engines=all         keep every Linux query engine (default: CloudLinux / RHEL only)
//
// Steps: clean (.next, dist) → production build + package (scripts/package-cpanel.mjs: standalone server,
// static files, public/, Prisma schema + migrations, app.js startup file, secret scan) → trim what never runs
// on the server (TypeScript, type declarations, source maps, docs, other platforms' engines) → SHA256SUMS.txt
// for check-files.cjs → dist/deploy.tar.gz (and dist/bijoy-lenden-cpanel.zip).
//
// No dev dependencies, caches, .env files or backups end up in the package.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const db = args.find((a) => a.startsWith("--db="))?.slice(5) ?? "mysql";
const allEngines = args.includes("--engines=all");
const dist = join(root, "dist");
const pkgDir = join(dist, "cpanel", "bijoy-lenden");
const step = (m) => console.log(`\n▶ ${m}`);
const size = (p) => {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  return readdirSync(p).reduce((t, f) => t + size(join(p, f)), 0);
};
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// 1. clean
step("clean: .next, dist/cpanel, old archives");
for (const p of [join(root, ".next"), join(dist, "cpanel"), join(dist, "deploy.tar.gz"), join(dist, "bijoy-lenden-cpanel.zip")]) rmSync(p, { recursive: true, force: true });

// 2. production build + package (also scans for secrets and restores the local Prisma Client)
execSync(`node scripts/package-cpanel.mjs --db=${db}`, { stdio: "inherit" });
if (!existsSync(join(pkgDir, "server.js")) || !existsSync(join(pkgDir, "app.js"))) {
  console.error("✖ package missing server.js / app.js");
  process.exit(1);
}
rmSync(join(dist, "bijoy-lenden-cpanel.zip"), { force: true }); // re-made below from the trimmed package
const before = size(pkgDir);

// 3. trim: nothing here is loaded at runtime
step("trim files the server never loads");
const removed = { files: 0, bytes: 0 };
const drop = (p) => {
  removed.bytes += size(p);
  removed.files++;
  rmSync(p, { recursive: true, force: true });
};
const nm = join(pkgDir, "node_modules");
// TypeScript is traced because of next.config.ts; the standalone server reads the compiled config instead
if (existsSync(join(nm, "typescript"))) drop(join(nm, "typescript"));
// cPanel / Recohost run CloudLinux (RHEL): the Debian and Alpine (musl) engines are only for Docker hosts
if (!allEngines) {
  const engines = join(nm, ".prisma", "client");
  for (const f of readdirSync(engines)) if (/^libquery_engine-/.test(f) && !/^libquery_engine-rhel-/.test(f)) drop(join(engines, f));
}
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) {
      walk(p);
      continue;
    }
    const inModules = relative(pkgDir, p).startsWith("node_modules");
    if (/\.(map)$/.test(f) || (inModules && (/\.d\.(ts|mts|cts)$/.test(f) || /^(README|CHANGELOG|HISTORY)(\.\w+)?$/i.test(f)))) drop(p);
  }
};
walk(pkgDir);
console.log(`  removed ${removed.files} files / folders, ${mb(removed.bytes)} — package ${mb(before)} → ${mb(size(pkgDir))}`);

// 4. checksum list for check-files.cjs (detects files the hosting antivirus quarantined)
step("SHA256SUMS.txt");
const sums = [];
const hashAll = (dir) => {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) hashAll(p);
    else if (f !== "SHA256SUMS.txt") sums.push(`${createHash("sha256").update(readFileSync(p)).digest("hex")}  ${relative(pkgDir, p).replace(/\\/g, "/")}`);
  }
};
hashAll(pkgDir);
writeFileSync(join(pkgDir, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(`  ${sums.length} files`);

// 5. archives
step("archives");
const winTar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const tar = process.platform === "win32" && existsSync(winTar) ? `"${winTar}"` : "tar";
const tgz = join(dist, "deploy.tar.gz");
execSync(`${tar} -czf "${tgz}" -C "${join(dist, "cpanel")}" bijoy-lenden`, { stdio: "inherit" });
console.log(`  ✔ ${relative(root, tgz)} (${mb(statSync(tgz).size)})`);
const zip = join(dist, "bijoy-lenden-cpanel.zip");
try {
  if (process.platform === "win32") execSync(`${tar} -a -c -f "${zip}" -C "${join(dist, "cpanel")}" bijoy-lenden`, { stdio: "inherit" });
  else execSync(`cd "${join(dist, "cpanel")}" && zip -qr "${zip}" bijoy-lenden`, { stdio: "inherit", shell: "/bin/sh" });
  console.log(`  ✔ ${relative(root, zip)} (${mb(statSync(zip).size)})`);
} catch {
  console.log("  (zip tool not available — use deploy.tar.gz)");
}
console.log(`\nDone (${db}). Upload dist/deploy.tar.gz — steps in deploy-guide.md.`);
