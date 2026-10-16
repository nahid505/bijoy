import "server-only";
// Feature & module management (server side). The registry in src/lib/features.ts is the source
// of truth; this file keeps the database catalogue in sync with it, answers "is this feature on
// for this business" (plan + platform administrator override) and guards pages and actions.
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { FEATURES, featureDef, type FeatureDef, type FeatureKey } from "@/lib/features";
import { loadFeatureAccess } from "./services/feature-state";

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

export const FEATURE_OFF_MESSAGE = (key: FeatureKey) => `"${featureDef(key).nameBn}" ফিচারটি আপনার বর্তমান প্ল্যানে নেই — সাবস্ক্রিপশন থেকে প্ল্যান আপগ্রেড করুন`;

/** For server actions / jobs: refuse when the feature is off. */
export async function assertFeature(businessId: string, key: FeatureKey) {
  if (!(await isFeatureOn(businessId, key))) throw new UserError(FEATURE_OFF_MESSAGE(key));
}

/** For pages: the forbidden page explains which feature is off. */
export async function requireFeature(businessId: string, key: FeatureKey) {
  if (!(await isFeatureOn(businessId, key))) redirect(`/forbidden?feature=${key}`);
}
