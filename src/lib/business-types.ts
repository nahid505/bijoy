import { BUSINESS_TYPES } from "./validation";

export type BusinessTypeKey = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessTypeKey, string> = {
  RETAIL: "খুচরা দোকান",
  WHOLESALE: "পাইকারি ব্যবসা",
  PHARMACY: "ফার্মেসি",
  GROCERY: "মুদি / সুপারশপ",
  ELECTRONICS: "ইলেকট্রনিক্স",
  CLOTHING: "পোশাক / ফ্যাশন",
  RESTAURANT: "রেস্টুরেন্ট / খাবার",
  MANUFACTURING: "উৎপাদন / কারখানা",
  AUTO_RICE_MILL: "অটো রাইস মিল",
  SERVICE: "সার্ভিস / মেরামত",
  DISTRIBUTION: "ডিস্ট্রিবিউশন / ডিলার",
  DEPOT: "ডিপো ব্যবসা",
  OTHER: "অন্যান্য",
};

/**
 * Business modules a business's types switch on (the sidebar shows a module's menus only when it is on):
 *   TRADING  general sales, POS, purchases and inventory — any type other than DEPOT, or no type at all
 *   DEPOT    depot management (dealers, challans, company commission …) — the DEPOT type
 *   RICE_MILL  auto rice mill (paddy & weighbridge, milling, rice / by-product stock and sales, mill reports) — AUTO_RICE_MILL
 * Core modules (dashboard, ledgers, reports, settings …) belong to no module and are always shown.
 */
export type BusinessModule = "TRADING" | "DEPOT" | "RICE_MILL";

export const MODULE_LABELS: Record<BusinessModule, string> = {
  TRADING: "বিক্রয়, পস, ক্রয় ও ইনভেন্টরি",
  DEPOT: "ডিপো ব্যবস্থাপনা",
  RICE_MILL: "অটো রাইস মিল ব্যবস্থাপনা",
};

export function businessModules(types: readonly string[]): Set<BusinessModule> {
  const on = new Set<BusinessModule>();
  if (types.length === 0 || types.some((t) => t !== "DEPOT")) on.add("TRADING"); // empty = a general business
  if (types.includes("DEPOT")) on.add("DEPOT");
  if (types.includes("AUTO_RICE_MILL")) on.add("RICE_MILL");
  return on;
}

/** Valid, distinct types in the list's own order (unknown values dropped). */
export function normalizeBusinessTypes(values: readonly unknown[]): BusinessTypeKey[] {
  const picked = new Set(values.map((v) => (typeof v === "string" ? v.trim().toUpperCase() : "")));
  return BUSINESS_TYPES.filter((t) => picked.has(t));
}

/** The single "primary" type kept in Business.businessType (read by the depot checks): DEPOT when chosen, else the first. */
export function primaryBusinessType(types: readonly string[]): string | null {
  return types.includes("DEPOT") ? "DEPOT" : (types[0] ?? null);
}

/** "খুচরা দোকান, ডিপো ব্যবসা" — or "সাধারণ" when none is chosen. */
export function businessTypesText(types: readonly string[]): string {
  return types.length ? types.map((t) => BUSINESS_TYPE_LABELS[t as BusinessTypeKey] ?? t).join(", ") : "সাধারণ";
}
