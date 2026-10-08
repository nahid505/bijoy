// Initial subscription plans (seeded once by the migrations; afterwards edited in the Super Admin
// panel). Shared by the PostgreSQL and MySQL seed generators.
import { FEATURES, type FeatureDef } from "../src/lib/features";

export const all = (FEATURES as readonly FeatureDef[]).map((f) => f.key);
export const FREE = ["ACCOUNTING", "SALES", "INVENTORY", "CUSTOMER"];
export const BASIC = [...FREE, "PURCHASE", "SUPPLIER", "MULTI_USER"];
export const BUSINESS = [...BASIC, "POS", "HRM", "PRODUCT_EXPIRY", "ADVANCED_REPORTING", "ADVANCED_INVENTORY"];

export const PLANS = [
  { id: "plan_free", code: "FREE", nameBn: "ফ্রি", nameEn: "Free", descBn: "ছোট ব্যবসার জন্য মৌলিক হিসাব, বিক্রয় ও স্টক — একজন ব্যবহারকারী।", descEn: "Basic accounting, sales and stock for one user.", monthly: 0, yearly: 0, users: 1, features: FREE },
  { id: "plan_basic", code: "BASIC", nameBn: "বেসিক", nameEn: "Basic", descBn: "হিসাব, বিক্রয়, ক্রয় ও ইনভেন্টরি — ৩ জন ব্যবহারকারী।", descEn: "Accounting, sales, purchase and inventory for 3 users.", monthly: 499, yearly: 4990, users: 3, features: BASIC },
  { id: "plan_business", code: "BUSINESS", nameBn: "বিজনেস", nameEn: "Business", descBn: "পূর্ণ হিসাব, পস, এইচআরএম, পণ্যের মেয়াদ ও অ্যাডভান্সড রিপোর্ট — ১০ জন ব্যবহারকারী।", descEn: "Full accounting, POS, HRM, product expiry and advanced reports for 10 users.", monthly: 1499, yearly: 14990, users: 10, features: BUSINESS },
  { id: "plan_premium", code: "PREMIUM", nameBn: "প্রিমিয়াম", nameEn: "Premium", descBn: "সব ইআরপি ফিচার, মাল্টি ওয়্যারহাউস ও ভবিষ্যতের সব মডিউল — ২৫ জন ব্যবহারকারী।", descEn: "Every ERP feature, multi-warehouse and all upcoming modules for 25 users.", monthly: 2999, yearly: 29990, users: 25, features: all },
];
