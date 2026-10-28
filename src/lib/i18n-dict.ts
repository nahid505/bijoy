// Both dictionaries, bundled — for the server (src/server/i18n.ts) and tests. Client components never import this:
// they get the current language's dictionary from <LangProvider> (src/components/lang.tsx).
import bn from "../locales/bn.json";
import en from "../locales/en.json";
import { translateWith, type Dict, type Lang, type TVars } from "./i18n";

export const DICTS: Record<Lang, Dict> = { bn, en };

export function translate(lang: Lang, text: string, vars?: TVars): string {
  return translateWith(DICTS[lang], text, vars);
}
