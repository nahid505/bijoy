// Every Bangla UI text in src/ — the keys src/locales/en.json must translate.
//
//   node scripts/i18n-extract.mjs            list the untranslated keys (count per file)
//   node scripts/i18n-extract.mjs --json F   write the untranslated keys to F as { key: "" } (to fill in)
//   node scripts/i18n-extract.mjs --check    exit 1 when a key has no English translation (CI / tests)
//
// Keys are what the UI shows: string literals, JSX text and template literals. A template literal's \${…} parts
// become {0}, {1}, … ("\${n} জন ডিলার" → "{0} জন ডিলার"); the English text uses the same placeholders.
// Left out: comments, files that build Bangla on purpose (number words) and SMS bodies sent to customers.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BN = /[ঀ-৿]/;
const SKIP_FILES = [
  "src/lib/words.ts", // amount in words (Bangla number words)
  "src/lib/sms-text.ts", // SMS bodies sent to customers / suppliers (their wording is the business's)
  "src/lib/screen-translate.ts", // the on-screen translator (Bangla only in its patterns and examples)
  "src/lib/mail.ts", // email bodies sent to users
  "src/lib/sms.ts", // SMS bodies sent to users
  "src/lib/ledger-upload.ts", // ledger image uploads
  "src/components/ledger-avatar.tsx", // avatar color mapping & letter extraction
];
const DATA_FILES = ["src/lib/business-defaults.json"];

function files(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** Strip comments (block and line) without touching "//" inside strings and URLs. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

// regular-expression sources built in template literals ("(?=\s+[0-9০-৯]{4})") are code, not UI text
const REGEX_SOURCE = /\(\?[=!:]|\[0-9০-৯\]/;

const ESC = { n: "\n", t: "\t", r: "\r" };

/**
 * Walk the code once: string literals, template literals (nested ones and those inside ${…} too) and the code with
 * every string and template blanked to "" (where the JSX text is looked for).
 */
function scan(s) {
  let rest = "";
  const literals = [];
  const templates = [];
  const template = (start) => {
    let j = start + 1;
    let out = "";
    let n = 0;
    while (j < s.length && s[j] !== "`") {
      if (s[j] === "\\") {
        out += ESC[s[j + 1]] ?? s[j + 1];
        j += 2;
      } else if (s[j] === "$" && s[j + 1] === "{") {
        out += `{${n++}}`;
        j = code(j + 2, true);
      } else out += s[j++];
    }
    templates.push(out);
    return j + 1;
  };
  // inExpr: inside ${…} — stops after its closing brace; the code there is not part of `rest`
  const code = (start, inExpr) => {
    let j = start;
    let depth = 0;
    while (j < s.length) {
      const c = s[j];
      if (c === '"' || c === "'") {
        let k = j + 1;
        let v = "";
        while (k < s.length && s[k] !== c && s[k] !== "\n") {
          if (s[k] === "\\") {
            v += ESC[s[k + 1]] ?? s[k + 1];
            k += 2;
          } else v += s[k++];
        }
        literals.push(v);
        if (!inExpr) rest += '""';
        j = k + 1;
        continue;
      }
      if (c === "`") {
        j = template(j);
        if (!inExpr) rest += '""';
        continue;
      }
      if (inExpr) {
        if (c === "{") depth++;
        else if (c === "}") {
          if (depth === 0) return j + 1;
          depth--;
        }
      } else rest += c;
      j++;
    }
    return j;
  };
  code(0, false);
  return { rest, literals, templates };
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

export function keysOf(src, isTsx = false) {
  const s = stripComments(src);
  const keys = new Set();
  const add = (v) => {
    const k = norm(v);
    if (k && BN.test(k) && !REGEX_SOURCE.test(k) && !k.includes("=>") && !k.includes("function") && !k.includes("import ") && !k.includes("export ") && !k.includes("const ") && !k.includes("let ") && !k.includes("var ")) {
      keys.add(k);
    }
  };
  const { rest, literals, templates } = scan(s);
  for (const v of literals) add(v);
  // a template literal's shape, its ${…} parts as {0}, {1} … ("${n} জন ডিলার" → "{0} জন ডিলার")
  for (const v of templates) if (BN.test(v)) add(v);
  if (isTsx) {
    const noStrings = rest; // strings and templates are already blanked by scan()
    // string literals are blanked here, so Bangla left outside them is JSX text; a piece that still reads like code is skipped
    // (entities are decoded: the screen shows the character — &quot; → ")
    const jsx = (v) => {
      if (!/=>|&&|\|\|/.test(v)) add(v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " "));
    };
    for (const m of noStrings.matchAll(/>([^<>{}]*[ঀ-৿][^<>{}]*)</g)) jsx(m[1]);
    // JSX text next to an expression, on one line or several: ">ডিলার {x}" / "{x} টি<" / "{x} জন নির্বাচিত</span>"
    for (const m of noStrings.matchAll(/>([^<>{}]*[ঀ-৿][^<>{}]*)\{/g)) jsx(m[1]);
    for (const m of noStrings.matchAll(/\}([^<>{}]*[ঀ-৿][^<>{}]*)</g)) jsx(m[1]);
    for (const m of noStrings.matchAll(/\}([^<>{}]*[ঀ-৿][^<>{}]*)\{/g)) jsx(m[1]);
  }
  return [...keys];
}

export function allKeys(root = ROOT) {
  const byFile = new Map();
  for (const f of files(join(root, "src"))) {
    const rel = relative(root, f).replace(/\\/g, "/");
    if (SKIP_FILES.includes(rel)) continue;
    const isTsx = f.endsWith(".tsx");
    const keys = keysOf(readFileSync(f, "utf8"), isTsx);
    if (keys.length) byFile.set(rel, keys);
  }
  // data every business starts with (default ledgers, units, roles) — shown on screen, so translated too
  for (const rel of DATA_FILES) {
    const keys = new Set();
    const walk = (v) => (typeof v === "string" ? BN.test(v) && keys.add(norm(v)) : v && typeof v === "object" && Object.values(v).forEach(walk));
    walk(JSON.parse(readFileSync(join(root, rel), "utf8")));
    byFile.set(rel, [...keys]);
  }
  return byFile;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const en = JSON.parse(readFileSync(join(ROOT, "src/locales/en.json"), "utf8"));
  const byFile = allKeys();
  const missing = new Map();
  for (const [f, keys] of byFile) for (const k of keys) if (!(k in en)) (missing.get(f) ?? missing.set(f, []).get(f)).push(k);
  const unique = new Set([...missing.values()].flat());
  const all = new Set([...byFile.values()].flat());
  const arg = process.argv.indexOf("--json");
  if (arg > 0) {
    writeFileSync(process.argv[arg + 1], JSON.stringify(Object.fromEntries([...unique].map((k) => [k, ""])), null, 2) + "\n");
  }
  console.log(`${all.size} keys, ${all.size - unique.size} translated, ${unique.size} missing`);
  if (!process.argv.includes("--check") && arg < 0) {
    for (const [f, keys] of [...missing].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) console.log(`  ${keys.length}\t${f}`);
  }
  if (process.argv.includes("--check") && unique.size) process.exit(1);
}
