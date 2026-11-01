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
export function LangToggle({ className }: { className?: string } = {}) {
  const { lang, dict } = useContext(LangCtx);
  const [pending, start] = useTransition();
  return (
    <div
      id="lang-switch"
      role="group"
      aria-label={translateWith(dict, "ভাষা নির্বাচন")}
      className={`inline-flex h-8 shrink-0 items-center rounded-lg border border-rule bg-slate-100/90 p-0.5 text-xs font-semibold shadow-2xs ${className ?? ""}`}
    >
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          disabled={pending || l === lang}
          aria-pressed={l === lang}
          onClick={() => start(() => setLangAction(l))}
          className={`flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-semibold transition-all ${
            l === lang
              ? "bg-emerald-700 text-white shadow-xs font-bold cursor-default"
              : "text-slate-600 hover:text-ink-900 hover:bg-white/60 cursor-pointer"
          }`}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
