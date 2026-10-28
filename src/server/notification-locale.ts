import "server-only";
import { prisma } from "@/lib/db";
import { localizeNotification } from "@/lib/notification-text";
import { getLang } from "./i18n";

/** Shows stored (Bangla) notification texts in the UI language — see src/lib/notification-text.ts. */
export async function notificationLocalizer(): Promise<(text: string) => string> {
  const lang = await getLang();
  if (lang !== "en") return (text) => text;
  const plans = await prisma.plan.findMany({ select: { nameBn: true, nameEn: true } });
  const names = Object.fromEntries(plans.map((p) => [p.nameBn, p.nameEn]));
  return (text) => localizeNotification(lang, text, names);
}
