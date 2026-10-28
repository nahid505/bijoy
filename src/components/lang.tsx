"use client";

import { createContext, use, useContext, useTransition } from "react";
import { LANG_LABELS, loadDict, translateWith, type Dict, type Lang, type TFn } from "@/lib/i18n";
import { setLangAction } from "@/server/actions/prefs";

const LangCtx = createContext<{ lang: Lang; dict: Dict }>({ lang: "bn", dict: {} });

// One load per language per page session: the same promise each render, so use() reads it synchronously once settled.
const loading: Partial<Record<Lang, Promise<Dict>>> = {};
const dictFor = (lang: Lang) => (loading[lang] ??= loadDict(lang));

/** Loads the current language's dictionary only (its own chunk) — the page renders once it is in. */
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const dict = use(dictFor(lang));
  return <LangCtx.Provider value={{ lang, dict }}>{children}</LangCtx.Provider>;
}

/** Client-side translator (Bangla strings are keys). */
export function useT(): TFn {
  const { dict } = useContext(LangCtx);
  return (text, vars) => translateWith(dict, text, vars);
}

/** The current UI language (client components). */
export function useLang(): Lang {
  return useContext(LangCtx).lang;
}

/** The current language's dictionary (the English-screen translator reads it). */
export function useDict(): Dict {
  return useContext(LangCtx).dict;
}

/** Header language switcher: বাংলা | English. The choice is kept in the bl_lang cookie (1 year), so a reload or the
 *  next visit opens in the same language; server-rendered pages read the same cookie. */
export function LangToggle() {
  const { lang, dict } = useContext(LangCtx);
  const [pending, start] = useTransition();
  return (
    <div id="lang-switch" role="group" aria-label={translateWith(dict, "ভাষা নির্বাচন")} className="flex shrink-0 overflow-hidden rounded border border-rule text-xs font-semibold">
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          disabled={pending || l === lang}
          aria-pressed={l === lang}
          onClick={() => start(() => setLangAction(l))}
          className={`px-2 py-1 ${l === lang ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-50"}`}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
