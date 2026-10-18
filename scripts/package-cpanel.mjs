// Builds a ready-to-upload package for cPanel "Setup Node.js App" (Phusion Passenger) hosting:
//
//   npm run package:cpanel                     MySQL / MariaDB build (default; cPanel "MySQL Databases")
//   npm run package:cpanel -- --db=postgresql   PostgreSQL build
//   → dist/cpanel/bijoy-lenden/ and dist/bijoy-lenden-cpanel.zip
//
// The Prisma Client is generated for the chosen database for the build and the local PostgreSQL
// client is restored afterwards (always, also when the build fails).
//
// The package contains the Next.js standalone server, static files, the Prisma schema + migrations,
// Linux query engines (CloudLinux / RHEL / Debian) and the cPanel helper files from deploy/cpanel.
// It NEVER contains .env files, backups or secrets — the script refuses to finish if it finds any.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "dist", "cpanel", "bijoy-lenden");
const db = (process.argv.find((a) => a.startsWith("--db="))?.slice(5) ?? "mysql").toLowerCase();
if (db !== "mysql" && db !== "postgresql") {
  console.error("--db must be mysql or postgresql");
  process.exit(1);
}
const mysql = db === "mysql";
const schemaDir = mysql ? join(root, "prisma", "mysql") : join(root, "prisma");
// placeholder URL of the right kind for generate / build (nothing connects to it)
const buildEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: mysql ? "mysql://build:build@localhost:3306/build" : "postgresql://build:build@localhost:5432/build" };
const step = (m) => console.log(`\n▶ ${m}`);
const restoreClient = () => {
  if (!mysql) return;
  step("restoring the local PostgreSQL Prisma Client");
  execSync("npx prisma generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: "postgresql://restore:restore@localhost:5432/restore" } });
};
process.on("exit", (code) => { if (code !== 0 && mysql) try { restoreClient(); } catch { /* reported above */ } });

if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "prisma", "schema.prisma"))) {
  console.error("Run from the project root.");
  process.exit(1);
}

if (mysql) {
  step("MySQL schema is up to date with prisma/schema.prisma");
  execSync("node scripts/mysql-schema.mjs --check", { stdio: "inherit" });
}
step(`prisma generate (${db}, all engine targets) + next build`);
execSync(`npx prisma generate --schema "${join(schemaDir, "schema.prisma")}"`, { stdio: "inherit", env: buildEnv });
execSync("npx next build", { stdio: "inherit", env: buildEnv });
const standalone = join(root, ".next", "standalone");
if (!existsSync(join(standalone, "server.js"))) {
  console.error("No .next/standalone/server.js — run without --skip-build.");
  process.exit(1);
}

step(`assembling ${relative(root, out)}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const isSecretFile = (p) => /(^|[\\/])\.env(\..*)?$/.test(p) && !p.endsWith(".env.example");
cpSync(standalone, out, { recursive: true, filter: (src) => !isSecretFile(src) });
cpSync(join(root, ".next", "static"), join(out, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(out, "public"), { recursive: true });
mkdirSync(join(out, "prisma"), { recursive: true });
cpSync(join(schemaDir, "schema.prisma"), join(out, "prisma", "schema.prisma"));
cpSync(join(schemaDir, "migrations"), join(out, "prisma", "migrations"), { recursive: true });
writeFileSync(join(out, "DATABASE.txt"), mysql ? "This package is built for MySQL 8.0.16+ / MariaDB 10.6+ (DATABASE_URL=mysql://…).\n" : "This package is built for PostgreSQL 13+ (DATABASE_URL=postgresql://…).\n");
for (const f of readdirSync(join(root, "deploy", "cpanel"))) cpSync(join(root, "deploy", "cpanel", f), join(out, f), { recursive: true });
cpSync(join(root, "FINAL-RECOHOST-DEPLOYMENT.md"), join(out, "FINAL-RECOHOST-DEPLOYMENT.md"));
cpSync(join(root, "deploy-guide.md"), join(out, "deploy-guide.md"));

// Linux query engines (next's file tracing only keeps the ones it saw at build time)
const engines = join(root, "node_modules", ".prisma", "client");
const target = join(out, "node_modules", ".prisma", "client");
mkdirSync(target, { recursive: true });
let n = 0;
for (const f of readdirSync(engines)) {
  if (/^libquery_engine-.*\.so\.node$/.test(f)) {
    cpSync(join(engines, f), join(target, f));
    n++;
  }
}
rmSync(join(target, "query_engine-windows.dll.node"), { force: true }); // not needed on the server
// image optimisation (sharp) is unused — the app has no next/image; drop the build machine's binaries
for (const d of existsSync(join(out, "node_modules", "@img")) ? readdirSync(join(out, "node_modules", "@img")) : []) {
  if (/^sharp-(win32|darwin)/.test(d)) rmSync(join(out, "node_modules", "@img", d), { recursive: true, force: true });
}
if (!readdirSync(target).some((f) => f.startsWith("libquery_engine-rhel"))) {
  console.error("CloudLinux (rhel) query engine missing — check binaryTargets in prisma/schema.prisma.");
  process.exit(1);
}
console.log(`  ${n} Linux query engine(s) included`);

// package.json used by cPanel ("Run NPM Install" is NOT needed — node_modules are bundled)
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: pkg.name, version: pkg.version, private: true, description: pkg.description,
  main: "app.js", scripts: { start: "node app.js" }, engines: pkg.engines,
}, null, 2) + "\n");

step("secret scan");
const bad = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "node_modules") continue;
      walk(p);
    } else {
      const rel = relative(out, p).replace(/\\/g, "/");
      const migration = /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(rel);
      if (isSecretFile(p) || /\.(pem|key|p12|dump)$/i.test(f) || (/\.sql(\.gz)?$/i.test(f) && !migration) || /^backups\//i.test(rel)) bad.push(rel);
    }
  }
};
walk(out);
const envLocal = existsSync(join(root, ".env")) ? readFileSync(join(root, ".env"), "utf8") : "";
const secrets = envLocal.split(/\r?\n/).map((l) => /^(AUTH_SECRET|POSTGRES_PASSWORD|SMS_API_KEY|BKASH_APP_SECRET|BKASH_PASSWORD|BILLING_WEBHOOK_SECRET|CRON_SECRET|SEED_ADMIN_PASSWORD)=(.{8,})$/.exec(l.trim())?.[2]).filter(Boolean);
if (secrets.length) {
  const grep = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) grep(p);
      else if (statSync(p).size < 20_000_000) {
        const text = readFileSync(p, "latin1");
        if (secrets.some((s) => text.includes(s))) bad.push(`${relative(out, p)} (contains a value from your local .env)`);
      }
    }
  };
  grep(out);
}
if (bad.length) {
  console.error("✖ Refusing to package — sensitive files found:\n  " + bad.join("\n  "));
  rmSync(out, { recursive: true, force: true });
  process.exit(1);
}
console.log("  ✔ no .env / keys / backups / local secret values in the package");

step("zip");
const zip = join(root, "dist", "bijoy-lenden-cpanel.zip");
rmSync(zip, { force: true });
try {
  // Windows' own bsdtar writes zip files (a GNU tar from Git Bash earlier in PATH would not)
  const winTar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (process.platform === "win32") execSync(`"${winTar}" -a -c -f "${zip}" -C "${join(root, "dist", "cpanel")}" bijoy-lenden`, { stdio: "inherit" });
  else execSync(`cd "${join(root, "dist", "cpanel")}" && zip -qr "${zip}" bijoy-lenden`, { stdio: "inherit", shell: "/bin/sh" });
  console.log(`  ✔ ${relative(root, zip)} (${(statSync(zip).size / 1048576).toFixed(1)} MB)`);
} catch {
  console.log("  (zip tool not available — upload the folder dist/cpanel/bijoy-lenden instead)");
}
restoreClient();
console.log(`\nDone (${db}). Next: FINAL-RECOHOST-DEPLOYMENT.md`);
