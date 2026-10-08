// Which features are on for a business — a plain database read with no Next.js / React imports,
// so services and the scheduler can use it. Pages and actions use the per-request cached
// version in src/server/features.ts.
//
//   on = feature exists (AVAILABLE)
//        AND the subscription entitles it (plan, or the fallback plan after expiry; super-admin overrides)
//        AND the company has not switched it off (BusinessFeature.enabled, default from the registry)
import { prisma } from "@/lib/db";
import { FEATURES, type FeatureDef, type FeatureKey } from "@/lib/features";
import type { Effective } from "@/lib/subscription";
import { entitlements } from "./subscriptions";

export interface FeatureAccess {
  on: Set<FeatureKey>;
  entitled: Set<string>;
  /** null = the business has no subscription row (treated as the fallback plan) */
  effective: Effective | null;
}

export async function loadFeatureAccess(businessId: string): Promise<FeatureAccess> {
  const [rows, ent] = await Promise.all([
    prisma.businessFeature.findMany({ where: { businessId }, select: { featureKey: true, enabled: true } }),
    entitlements(businessId),
  ]);
  const chosen = new Map(rows.map((r) => [r.featureKey, r.enabled]));
  const on = new Set<FeatureKey>();
  for (const f of FEATURES as readonly FeatureDef[]) {
    if (f.status !== "AVAILABLE") continue; // a module that does not exist yet is never on
    if (!ent.keys.has(f.key)) continue; // not in the plan
    if (chosen.get(f.key) ?? f.defaultEnabled) on.add(f.key as FeatureKey);
  }
  return { on, entitled: ent.keys, effective: ent.effective };
}

export async function loadEnabledFeatures(businessId: string): Promise<Set<FeatureKey>> {
  return (await loadFeatureAccess(businessId)).on;
}

export async function featureIsOn(businessId: string, key: FeatureKey) {
  return (await loadEnabledFeatures(businessId)).has(key);
}
