// A "use client" file must never reach server-only code (server-only, next/headers, @/server/*) through its imports.
//   node scripts/check-client-imports.mjs     exit 1 and list the chains when one does
// Imports are followed through non-client modules only: a "use client" module is its own boundary, and a
// "use server" module (Server Actions) may be imported by client code by design.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const SERVER_ONLY = /^(server-only|next\/headers)$/;

function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

function resolveImport(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

const cache = new Map();
function info(f) {
  if (!cache.has(f)) {
    const src = readFileSync(f, "utf8");
    const isClient = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);
    const isAction = /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src); // Server Actions — callable from the client by design
    // value imports only — "import type" is erased at build time
    const specs = [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
    cache.set(f, { isClient, isAction, specs });
  }
  return cache.get(f);
}

export function clientViolations() {
  const bad = [];
  for (const f of files(SRC)) {
    if (!info(f).isClient) continue;
    const seen = new Set();
    const walk = (file, chain) => {
      for (const spec of info(file).specs) {
        const next = resolveImport(spec, file);
        if (next && info(next).isAction) continue;
        if (SERVER_ONLY.test(spec) || spec.startsWith("@/server/")) {
          bad.push([...chain, spec].map((x) => (x.startsWith(ROOT) ? relative(ROOT, x).replace(/\\/g, "/") : x)).join(" → "));
          continue;
        }
        if (!next || seen.has(next) || info(next).isClient) continue;
        seen.add(next);
        walk(next, [...chain, next]);
      }
    };
    walk(f, [f]);
  }
  return bad;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const bad = clientViolations();
  for (const b of bad) console.log(b);
  console.log(bad.length ? `${bad.length} client import(s) reach server-only code` : "client components: no server-only imports");
  if (bad.length) process.exit(1);
}
