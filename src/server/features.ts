import "server-only";
// Feature & module management (server side). The registry in src/lib/features.ts is the source
// of truth; this file keeps the database catalogue in sync with it, answers "is this feature on
// for this business", switches features (with activation log + audit) and guards actions.
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { FEATURES, featureDef, isFeatureKey, type FeatureDef, type FeatureKey } from "@/lib/features";
import { loadFeatureAccess } from "./services/feature-state";
import { notifyBusiness } from "./services/billing-notify";
import { platformSettings, planByCode } from "./services/subscriptions";

let synced: Promise<void> | null = null;

/** Upserts the Feature / FeaturePermission catalogue from the registry (once per process). */
export function ensureFeatureCatalog(): Promise<void> {
  synced ??= (async () => {
    const defs = FEATURES as readonly FeatureDef[];
    await prisma.$transaction(async (tx) => {
      for (const [i, f] of defs.entries()) {
        const data = { nameBn: f.nameBn, nameEn: f.nameEn, descriptionBn: f.descriptionBn, descriptionEn: f.descriptionEn, icon: f.icon, tier: f.tier, status: f.status, defaultEnabled: f.defaultEnabled, sortOrder: i * 10 };
        await tx.feature.upsert({ where: { key: f.key }, create: { key: f.key, ...data }, update: data });
        const rows = Object.entries(f.permissions).flatMap(([action, perms]) => (perms ?? []).map((permission) => ({ featureKey: f.key, action, permission, owned: (f.owns as readonly string[]).includes(permission) })));
        await tx.featurePermission.deleteMany({ where: { featureKey: f.key } });
        if (rows.length) await tx.featurePermission.createMany({ data: rows });
      }
    });
  })().catch((err) => {
    synced = null; // retry on the next request
    throw err;
  });
  return synced;
}

/** Keys of the features that are on for a business (memoised per request). */
/** Features on / entitled and the subscription state of a business (memoised per request). */
export const featureAccess = cache((businessId: string) => loadFeatureAccess(businessId));
export const enabledFeatures = cache(async (businessId: string): Promise<Set<FeatureKey>> => (await featureAccess(businessId)).on);

export async function isFeatureOn(businessId: string, key: FeatureKey) {
  return (await enabledFeatures(businessId)).has(key);
}

export const FEATURE_OFF_MESSAGE = (key: FeatureKey) => `"${featureDef(key).nameBn}" ফিচারটি এই ব্যবসায় বন্ধ আছে — ফিচার ব্যবস্থাপনা থেকে চালু করুন`;

/** For server actions / jobs: refuse when the feature is off. */
export async function assertFeature(businessId: string, key: FeatureKey) {
  if (!(await isFeatureOn(businessId, key))) throw new UserError(FEATURE_OFF_MESSAGE(key));
}

/** For pages: the forbidden page explains which feature is off. */
export async function requireFeature(businessId: string, key: FeatureKey) {
  if (!(await isFeatureOn(businessId, key))) redirect(`/forbidden?feature=${key}`);
}

/**
 * Switches a feature on or off for a business. Data is never touched — only access changes.
 * Only AVAILABLE features can be switched on; Multi User can only be switched off by an Owner
 * (it closes the business to everyone else, including the admin making the change).
 */
export async function setFeatureEnabled(
  ctx: { businessId: string; userId: string; isOwner: boolean },
  key: string,
  enabled: boolean,
  note: string | null,
) {
  if (!isFeatureKey(key)) throw new UserError("ফিচার পাওয়া যায়নি");
  const def = featureDef(key);
  if (def.status !== "AVAILABLE") throw new UserError(`"${def.nameBn}" এখনো প্রস্তুত নয় (শীঘ্রই আসছে) — চালু করা যাবে না`);
  if (key === "MULTI_USER" && !enabled && !ctx.isOwner) throw new UserError("মাল্টি ইউজার শুধু মালিক বন্ধ করতে পারেন (বন্ধ করলে অন্য সব ব্যবহারকারীর প্রবেশ বন্ধ হবে)");
  if (enabled && !(await loadFeatureAccess(ctx.businessId)).entitled.has(key)) throw new UserError(`"${def.nameBn}" আপনার বর্তমান প্ল্যানে নেই — প্ল্যান আপগ্রেড করুন`);
  await ensureFeatureCatalog();
  return prisma.$transaction(async (tx) => {
    const current = await tx.businessFeature.findUnique({ where: { businessId_featureKey: { businessId: ctx.businessId, featureKey: key } } });
    const was = current?.enabled ?? def.defaultEnabled;
    if (was === enabled) throw new UserError(`"${def.nameBn}" ইতিমধ্যে ${enabled ? "চালু" : "বন্ধ"} আছে`);
    await tx.businessFeature.upsert({
      where: { businessId_featureKey: { businessId: ctx.businessId, featureKey: key } },
      create: { businessId: ctx.businessId, featureKey: key, enabled, changedById: ctx.userId },
      update: { enabled, changedById: ctx.userId, changedAt: new Date() },
    });
    await tx.featureActivationLog.create({ data: { businessId: ctx.businessId, featureKey: key, action: enabled ? "ENABLED" : "DISABLED", userId: ctx.userId, note } });
    await notifyBusiness(tx, ctx.businessId, { kind: "FEATURE_CHANGED", key: `feature:${key}:${Date.now()}`, title: `ফিচার ${enabled ? "চালু" : "বন্ধ"}: ${def.nameBn}`, message: enabled ? "মেনু ও পাতা এখন দেখা যাবে।" : "প্রবেশ বন্ধ — সংরক্ষিত তথ্য মুছে যায়নি।", link: "/features" });
    return { key, enabled, def };
  });
}

/** Everything the Feature Management page shows. */
export async function featureOverview(businessId: string) {
  await ensureFeatureCatalog();
  const [catalogue, rows, logs, access, settings] = await Promise.all([
    prisma.feature.findMany({ orderBy: { sortOrder: "asc" }, include: { permissions: true, plans: { include: { plan: { select: { code: true, nameBn: true, isActive: true, sortOrder: true } } } } } }),
    prisma.businessFeature.findMany({ where: { businessId } }),
    prisma.featureActivationLog.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 30, include: { feature: { select: { nameBn: true } } } }),
    featureAccess(businessId),
    platformSettings(),
  ]);
  const on = access.on;
  const freeKeys = new Set((await planByCode(prisma, settings.fallbackPlanCode))?.features.map((f) => f.featureKey) ?? []);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set([...logs.map((l) => l.userId), ...rows.map((r) => r.changedById ?? "")])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const byKey = new Map(rows.map((r) => [r.featureKey, r]));
  return {
    features: catalogue.filter((f) => isFeatureKey(f.key)).map((f) => {
      const row = byKey.get(f.key);
      return {
        key: f.key as FeatureKey, nameBn: f.nameBn, nameEn: f.nameEn, descriptionBn: f.descriptionBn, descriptionEn: f.descriptionEn, icon: f.icon, tier: f.tier, status: f.status,
        enabled: on.has(f.key as FeatureKey), entitled: access.entitled.has(f.key), free: freeKeys.has(f.key), override: row?.adminOverride ?? null,
        plans: f.plans.filter((p) => p.plan.isActive).sort((a, b) => a.plan.sortOrder - b.plan.sortOrder).map((p) => p.plan.nameBn),
        changedAt: row?.changedAt ?? null, changedBy: row?.changedById ? users.get(row.changedById) ?? null : null,
        permissions: f.permissions.map((p) => ({ action: p.action, permission: p.permission, owned: p.owned })),
      };
    }),
    logs: logs.map((l) => ({ id: l.id, featureKey: l.featureKey, name: l.feature.nameBn, action: l.action, user: users.get(l.userId) ?? "—", note: l.note, at: l.createdAt })),
  };
}
