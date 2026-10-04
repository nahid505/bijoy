"use client";

import { createContext, useContext, useTransition } from "react";
import { translate, type Lang } from "@/lib/i18n";
import { setLangAction } from "@/server/actions/prefs";

const LangCtx = createContext<Lang>("bn");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}

/** Client-side translator (Bangla strings are keys). */
export function useT() {
  const lang = useContext(LangCtx);
  return (text: string) => translate(lang, text);
}

export function LangToggle() {
  const lang = useContext(LangCtx);
  const [pending, start] = useTransition();
  const next: Lang = lang === "bn" ? "en" : "bn";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setLangAction(next))}
      className="shrink-0 rounded border border-rule px-2 py-1 text-xs font-semibold text-ink-700 hover:bg-ink-50"
      title={lang === "bn" ? "Switch to English" : "বাংলায় দেখুন"}
    >
      {lang === "bn" ? "EN" : "বাং"}
    </button>
  );
}
