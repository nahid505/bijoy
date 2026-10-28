// English screen: Bangla UI text that was not passed through t() is looked up in the English dictionary as rendered.
//   "নতুন ডেলিভারি চালান"          exact key                      → "New Delivery Challan"
//   "  কমিশন হার * "                key inside affixes / spaces    → "  Commission Rate * "
//   "৫ জন ডিলার"                    template key "{0} জন ডিলার"     → "৫ dealers" (digits are made English afterwards)
// Text with no matching key (names, notes — the business's own data) is left exactly as it is.
import type { Dict } from "./i18n";
import { MONTH_NAMES } from "./format";

const BN_LETTER = /[ঀ-৿]/;
// marks around a label that are not part of the key: "+ নতুন", "নাম *", "তারিখ:", "(বাকি)", "✔ চালু", "অপেক্ষা…"
const AFFIX = /^([\s+←→✔✖•·—–\-(*"“'‘:]*)([\s\S]*?)([\s*:।…—–\-)"”'’?!.,]*)$/;

const NUM = "[-+]?[0-9০-৯][0-9০-৯.,]*";
const LEAD_NUM = new RegExp(`^(৳\\s*)?(${NUM})(\\s*)(.+)$`);
const TRAIL_NUM = new RegExp(`^(.+?)(\\s*)(${NUM})$`);
const LIST_SEP = /( — | · |, | \| | – )/;
const BILINGUAL = /^(.+?)\s*\(([A-Za-z][^()]*)\)$/;

type Pattern = { re: RegExp; names: string[]; value: string; short: boolean };
// a key with only a few Bangla letters of its own ("{0} কেজি", "{n} জন") fills in numbers, dates and English only —
// otherwise it would rewrite the business's own names ("মিনিকেট চাল ২৫ কেজি")
const SHORT_KEY = 8;
const NOT_WORDS = new RegExp(`[০-৯৳]|${MONTH_NAMES.join("|")}`, "g"); // digits, Taka, month names (a date) are not words
const hasWords = (v: string) => BN_LETTER.test(v.replace(NOT_WORDS, ""));

/** "{0} জন ডিলার" → /^(.+?) জন ডিলার$/ — only keys with at least three Bangla letters of their own (no "{0} {1}"). */
function compilePatterns(dict: Dict): Pattern[] {
  const out: Pattern[] = [];
  for (const [key, value] of Object.entries(dict)) {
    // side-by-side placeholders ("{0}{1}") have no text between them to split on — t() still uses such keys
    if (!key.includes("{") || key === value || /\}\{/.test(key)) continue;
    const literal = key.replace(/\{\w+\}/g, "");
    if ((literal.match(/[ঀ-৿]/g) ?? []).length < 3) continue;
    const names: string[] = [];
    const src = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) {
          names.push(m[1]);
          return "(.+?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      })
      .join("");
    out.push({ re: new RegExp(`^${src}$`), names, value, short: (literal.match(/[ঀ-৿]/g) ?? []).length < SHORT_KEY });
  }
  // longer (more specific) keys first
  return out.sort((a, b) => b.re.source.length - a.re.source.length);
}

export type ScreenTranslator = (text: string) => string | null;

/** A translator for on-screen text: the English text, or null when there is nothing to change. */
export function screenTranslator(dict: Dict): ScreenTranslator {
  const patterns = compilePatterns(dict);
  const cache = new Map<string, string | null>();

  const exact = (s: string): string | undefined => {
    const v = dict[s];
    return v !== undefined && v !== s ? v : undefined;
  };

  // one piece of text (trimmed, single-spaced): a key, a template key, a key inside marks, "৫০ মণ", "ফ্রি (Free)"
  const one = (s: string, depth: number): string | undefined =>
    exact(s) ?? template(s, depth) ?? affixed(s, depth) ?? numbered(s) ?? bilingual(s);

  const template = (s: string, depth: number): string | undefined => {
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m || (p.short && m.slice(1).some((v) => hasWords(v) && part(v) === v))) continue; // Bangla only if it is UI text
      const vars = Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]]));
      // a filled-in part may itself be UI text ("{0} — বর্তমান ব্যালেন্স" with "ডিপো ক্যাশ")
      return p.value.replace(/\{(\w+)\}/g, (all, n: string) => (n in vars ? part(vars[n]) : all));
    }
    return undefined;
  };

  const affixed = (s: string, depth: number): string | undefined => {
    const m = AFFIX.exec(s);
    if (!m || !m[2] || !(m[1] || m[3])) return undefined;
    const inner = exact(m[2]) ?? template(m[2], depth) ?? numbered(m[2]);
    return inner === undefined ? undefined : m[1] + inner + m[3];
  };

  // a number with a unit or label: "০.০০ মণ", "৳ ৫০০ বাকি", "সারি ৩"
  const numbered = (s: string): string | undefined => {
    let m = LEAD_NUM.exec(s);
    if (m) {
      const rest = exact(m[4]);
      if (rest !== undefined) return (m[1] ?? "") + m[2] + m[3] + rest;
    }
    m = TRAIL_NUM.exec(s);
    if (m) {
      const head = exact(m[1]);
      if (head !== undefined) return head + m[2] + m[3];
    }
    return undefined;
  };

  // "ফ্রি (Free)", "মালিক (Owner)": the Bangla already says what the brackets say — once is enough in English
  const bilingual = (s: string): string | undefined => {
    const m = BILINGUAL.exec(s);
    if (!m) return undefined;
    const head = exact(m[1]);
    if (head === undefined) return undefined;
    return head.toLowerCase() === m[2].trim().toLowerCase() ? m[2].trim() : `${head} (${m[2]})`;
  };

  // a list or a line built from pieces: "খুচরা দোকান, ডিপো ব্যবসা", "মেয়াদ ১১ নভেম্বর ২০২৬ · আর ১৪ দিন" — every
  // Bangla piece must be known, or the text is left as it is (it is the business's own)
  const listed = (s: string, depth: number): string | undefined => {
    const parts = s.split(LIST_SEP);
    if (parts.length < 3) return undefined;
    let changed = false;
    const out = parts.map((x, i) => {
      if (i % 2 === 1 || !BN_LETTER.test(x) || !hasWords(x)) return x; // separators, and dates / numbers (made English later)
      const v = depth > 2 ? exact(x.trim()) : one(x.trim(), depth);
      if (v === undefined) return null;
      changed = true;
      return x.replace(x.trim(), v);
    });
    return changed && !out.includes(null) ? out.join("") : undefined;
  };

  // a filled-in part of a template key: translated only when it is UI text itself (a key, or a list of keys)
  const part = (v: string): string => {
    const s = v.trim();
    if (!BN_LETTER.test(s)) return v;
    const hit = exact(s) ?? bilingual(s) ?? listed(s, 3);
    return hit === undefined ? v : v.replace(s, hit);
  };

  const run = (text: string): string | null => {
    if (!BN_LETTER.test(text)) return null;
    const lead = /^\s*/.exec(text)![0];
    const trail = /\s*$/.exec(text)![0];
    const body = text.slice(lead.length, text.length - trail.length).replace(/\s+/g, " ");
    if (!body) return null;
    const hit = one(body, 0) ?? listed(body, 0);
    return hit === undefined || hit === body ? null : lead + hit + trail;
  };

  return (text) => {
    if (cache.has(text)) return cache.get(text)!;
    const v = run(text);
    if (cache.size > 5000) cache.clear();
    cache.set(text, v);
    return v;
  };
}

/** The browser tab title: "পেজ | বিজয় লেনদেন" → each part translated. */
export function translateTitle(tr: ScreenTranslator, title: string): string | null {
  const parts = title.split(" | ");
  const out = parts.map((p) => tr(p) ?? p);
  return out.some((p, i) => p !== parts[i]) ? out.join(" | ") : null;
}
