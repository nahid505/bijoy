// Bangla-first UI with an English option. The Bangla text is the key (it is what the code says):
//   src/locales/en.json  Bangla → English
//   src/locales/bn.json  Bangla → Bangla (the wording shown in Bangla; change it here without touching code)
// A string missing from a file shows as written. Language: the bl_lang cookie (1 year), switched in the header.
//
// This file is client-safe and holds no dictionary: the browser loads only the current language's file (loadDict),
// as its own chunk. Server code and tests use the synchronous translate() in src/lib/i18n-dict.ts.

export type Lang = "bn" | "en";
export const LANG_COOKIE = "bl_lang";
export const DEFAULT_LANG: Lang = "bn";
export const LANG_LABELS: Record<Lang, string> = { bn: "বাংলা", en: "English" };

/** One language's dictionary: Bangla key → text in that language. */
export type Dict = Record<string, string>;
/** Values for {placeholders} in a key: t("আর {n} দিন বাকি", { n: toBnDigits(5) }) */
export type TVars = Record<string, string | number>;
/** A translator: the text (a dictionary key) in the current language, with its {placeholders} filled. */
export type TFn = (text: string, vars?: TVars) => string;

export function translateWith(dict: Dict, text: string, vars?: TVars): string {
  const s = dict[text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** The language's dictionary, loaded on demand (a separate chunk in the browser). */
export function loadDict(lang: Lang): Promise<Dict> {
  return (lang === "en" ? import("../locales/en.json") : import("../locales/bn.json")).then((m) => m.default as Dict);
}

/** English month names for dates shown in English (the Bangla ones are in src/lib/format.ts). */
export const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isLang(v: string | undefined): v is Lang {
  return v === "bn" || v === "en";
}
