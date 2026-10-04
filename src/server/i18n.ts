import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { isLang, LANG_COOKIE, translate, type Lang } from "@/lib/i18n";

export const getLang = cache(async (): Promise<Lang> => {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "bn";
});

/** Server-side translator for the current request. */
export async function getT() {
  const lang = await getLang();
  return (text: string) => translate(lang, text);
}
