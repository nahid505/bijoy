import type { BUSINESS_TYPES } from "./validation";

export const BUSINESS_TYPE_LABELS: Record<(typeof BUSINESS_TYPES)[number], string> = {
  RETAIL: "খুচরা দোকান",
  WHOLESALE: "পাইকারি ব্যবসা",
  PHARMACY: "ফার্মেসি",
  GROCERY: "মুদি / সুপারশপ",
  ELECTRONICS: "ইলেকট্রনিক্স",
  CLOTHING: "পোশাক / ফ্যাশন",
  RESTAURANT: "রেস্টুরেন্ট / খাবার",
  MANUFACTURING: "উৎপাদন / কারখানা",
  SERVICE: "সার্ভিস / মেরামত",
  DISTRIBUTION: "ডিস্ট্রিবিউশন / ডিলার",
  DEPOT: "ডিপো ব্যবসা",
  OTHER: "অন্যান্য",
};
