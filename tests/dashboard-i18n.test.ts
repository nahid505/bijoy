// The dashboard is fully translatable: every Bangla text its files show must be a key in src/locales/en.json (the code
// passes it through t()). A new hardcoded Bangla string without an English translation fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import { translate } from "@/lib/i18n-dict";

const FILES = [
  "src/app/(app)/dashboard/page.tsx",
  "src/app/(app)/dashboard/dashboard-parts.tsx",
  "src/app/(app)/dashboard/assigned-panel.tsx",
  "src/app/(app)/dashboard/depot-panel.tsx",
  "src/components/subscription-banner.tsx",
  "src/components/expiry-badge.tsx",
];
const BANGLA = /[ঀ-৿]/;

/** Bangla texts in a file: string literals and JSX text, comments and the metadata title left out. */
function banglaTexts(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/export const metadata[^\n]*/g, "");
  const out = new Set<string>();
  for (const m of src.matchAll(/"([^"\n]*)"/g)) if (BANGLA.test(m[1])) out.add(m[1]);
  for (const m of src.matchAll(/>([^<>{}\n]+)</g)) if (BANGLA.test(m[1])) out.add(m[1].trim());
  return [...out];
}

describe("dashboard translations", () => {
  it("every Bangla text on the dashboard has an English translation", () => {
    const missing = FILES.flatMap((f) => banglaTexts(f).filter((s) => !(s in en)).map((s) => `${f}: ${s}`));
    expect(missing).toEqual([]);
  });

  it("placeholders: the trial banner and counts", () => {
    expect(translate("en", "ফ্রি ট্রায়াল চলছে — আর {n} দিন বাকি।", { n: 20 })).toBe("Free trial — 20 days left.");
    expect(translate("bn", "ফ্রি ট্রায়াল চলছে — আর {n} দিন বাকি।", { n: "২০" })).toBe("ফ্রি ট্রায়াল চলছে — আর ২০ দিন বাকি।");
    expect(translate("en", "{name} — বর্তমান ব্যালেন্স", { name: translate("en", "ডিপো ক্যাশ") })).toBe("Depot cash — current balance");
  });
});
