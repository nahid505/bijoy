// Account notifications (subscription, payment, plan, users, features): in-app notification for the
// business, plus optional SMS to the owner through the PLATFORM gateway and e-mail through the
// e-mail channel. Channels never throw: a failed SMS / e-mail must not undo a payment or plan change.
import type { NotificationKind, NotificationSeverity, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendEmail } from "../notify/email";
import { sendPlatformSms } from "../sms/platform";

type Db = PrismaClient | Prisma.TransactionClient;

export interface AccountNotice {
  kind: NotificationKind;
  key: string; // dedupe key (one notification per key and business)
  title: string;
  message: string;
  link?: string;
  severity?: NotificationSeverity;
  /** also send to the owner by SMS / e-mail (after the database work) */
  sms?: boolean;
}

/** Creates the notification once per dedupe key. Returns false when it already existed. */
export async function notifyBusiness(db: Db, businessId: string, n: AccountNotice): Promise<boolean> {
  const exists = await db.notification.findUnique({ where: { businessId_dedupeKey: { businessId, dedupeKey: n.key } }, select: { id: true } });
  if (exists) return false;
  await db.notification.create({ data: { businessId, kind: n.kind, severity: n.severity ?? "INFO", dedupeKey: n.key, title: n.title, message: n.message, link: n.link ?? null } });
  if (n.sms) {
    // outside the caller's transaction (channels are best effort and must not hold locks); sent only
    // once the notification is committed, so a rolled-back payment never triggers a message
    setTimeout(() => void deliverToOwner(businessId, n).catch(() => undefined), 1500);
  }
  return true;
}

async function deliverToOwner(businessId: string, n: AccountNotice) {
  if (!(await prisma.notification.findUnique({ where: { businessId_dedupeKey: { businessId, dedupeKey: n.key } }, select: { id: true } }))) return;
  const owner = await prisma.membership.findFirst({ where: { businessId, isActive: true, role: { isSystem: true } }, orderBy: { createdAt: "asc" }, include: { user: { select: { mobile: true, email: true } } } });
  if (!owner) return;
  const text = `বিজয় লেনদেন: ${n.title}। ${n.message}`.slice(0, 300);
  if (owner.user.mobile) await sendPlatformSms(prisma, owner.user.mobile, text, `acct:${businessId}:${n.key}`);
  if (owner.user.email) await sendEmail({ to: owner.user.email, subject: `বিজয় লেনদেন — ${n.title}`, text: `${n.title}\n\n${n.message}` });
}
