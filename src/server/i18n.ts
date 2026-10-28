import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { isLang, LANG_COOKIE, type Lang, type TFn } from "@/lib/i18n";
import { translate } from "@/lib/i18n-dict";

export const getLang = cache(async (): Promise<Lang> => {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "bn";
});

/** Server-side translator for the current request. */
export async function getT(): Promise<TFn> {
  const lang = await getLang();
  return (text, vars) => translate(lang, text, vars);
}
