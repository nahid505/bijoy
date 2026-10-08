import "server-only";
// Plans as shown on the pricing page, the company billing panel and the Super Admin panel — read
// from the database (prices, user limits and features are configured there, not in code).
import { prisma, num } from "@/lib/db";
import { FEATURES, type FeatureDef } from "@/lib/features";
import { platformSettings } from "../services/subscriptions";

export interface PlanCard {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string | null;
  descriptionEn: string | null;
  priceMonthly: number;
  priceYearly: number;
  userLimit: number | null;
  isActive: boolean;
  isPublic: boolean;
  free: boolean;
  features: string[];
}

export async function loadPlans(opts: { publicOnly?: boolean; activeOnly?: boolean } = {}) {
  const [plans, settings] = await Promise.all([
    prisma.plan.findMany({
      where: { ...(opts.publicOnly ? { isPublic: true } : {}), ...(opts.activeOnly ? { isActive: true } : {}) },
      orderBy: { sortOrder: "asc" },
      include: { features: { select: { featureKey: true } } },
    }),
    platformSettings(),
  ]);
  const cards: PlanCard[] = plans.map((p) => ({
    id: p.id, code: p.code, nameBn: p.nameBn, nameEn: p.nameEn, descriptionBn: p.descriptionBn, descriptionEn: p.descriptionEn,
    priceMonthly: num(p.priceMonthly), priceYearly: num(p.priceYearly), userLimit: p.userLimit, isActive: p.isActive, isPublic: p.isPublic,
    free: num(p.priceMonthly) === 0 && num(p.priceYearly) === 0, features: p.features.map((f) => f.featureKey),
  }));
  // comparison rows: every feature some plan offers, in registry order
  const offered = new Set(cards.flatMap((c) => c.features));
  const features = (FEATURES as readonly FeatureDef[]).filter((f) => offered.has(f.key)).map((f) => ({ key: f.key, nameBn: f.nameBn, nameEn: f.nameEn, icon: f.icon, soon: f.status === "COMING_SOON" }));
  return { plans: cards, features, settings };
}
