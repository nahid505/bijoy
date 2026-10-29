// Feature & module registry — the single source of truth for optional modules.
//
// A business can switch an AVAILABLE feature on or off (Feature Management page). Switching off
// never deletes data; it only closes access, enforced on the server in three ways:
//   1. permissions a feature owns (`owns`) are blocked in the request context, so every existing
//      requirePermission / assertPermission / API check refuses them and their menus disappear;
//   2. routes (`routes`, `reports`) are refused by the app layout and the report export API;
//   3. feature-specific actions and jobs check `isFeatureOn` themselves (expiry write-off, alerts,
//      warehouse management).
// COMING_SOON features are registered (name, permissions, routes) so their modules can be added
// later without changing this system, but they cannot be switched on.
// Which features a business may use comes from its subscription plan (Plan → PlanFeature, configured
// in the database by the platform super admin); the company admin then switches entitled features
// on or off. The database (Feature / FeaturePermission) mirrors this list; see src/server/features.ts.
import type { Permission } from "./permissions";

export const FEATURE_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE", "APPROVE", "EXPORT", "PRINT"] as const;
export type FeatureAction = (typeof FEATURE_ACTIONS)[number];
export const FEATURE_ACTION_LABELS: Record<FeatureAction, string> = { VIEW: "দেখা", CREATE: "তৈরি", EDIT: "সম্পাদনা", DELETE: "মুছা", APPROVE: "অনুমোদন", EXPORT: "এক্সপোর্ট", PRINT: "প্রিন্ট" };

export interface FeatureDef {
  key: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string;
  descriptionEn: string;
  icon: string; // emoji, shown on the card
  tier: "FREE" | "PAID";
  status: "AVAILABLE" | "COMING_SOON";
  /** on for a business that never changed it (keeps existing businesses working as before) */
  defaultEnabled: boolean;
  /** which permission keys grant each action in this module (role editor, Feature page) */
  permissions: Partial<Record<FeatureAction, string[]>>;
  /** permissions used ONLY by this module — blocked for everyone while it is off */
  owns: Permission[];
  /** path prefixes of the module's pages */
  routes: string[];
  /** report slugs of the module (/reports/<slug> and its export) */
  reports: string[];
  /** the module entry page and the permission it needs (dashboard shortcut) */
  home?: { href: string; permission: Permission };
}

export const FEATURES = [
  {
    key: "ACCOUNTING",
    nameBn: "হিসাব (অ্যাকাউন্টিং)",
    nameEn: "Accounting",
    descriptionBn: "ডাবল-এন্ট্রি হিসাব: রিসিপ্ট, পেমেন্ট, জার্নাল, খরচ, চার্ট অব অ্যাকাউন্টস, ক্যাশ ও ব্যাংক বুক।",
    descriptionEn: "Double-entry books: receipts, payments, journals, expenses, chart of accounts, cash and bank books.",
    icon: "📒",
    tier: "FREE",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: {
      VIEW: ["vouchers:view", "accounts:view", "reports.ledger:view"], CREATE: ["vouchers:create", "accounts:manage"], EDIT: ["vouchers:edit", "accounts:manage"], DELETE: ["vouchers:delete"],
      EXPORT: ["reports:view", "reports.ledger:print"], PRINT: ["vouchers:view", "reports.ledger:print"],
    },
    owns: ["vouchers:view", "vouchers:create", "vouchers:edit", "vouchers:delete", "accounts:view", "accounts:manage", "reports.ledger:view", "reports.ledger:print"],
    routes: ["/vouchers/receipt", "/vouchers/payment", "/vouchers/journal", "/accounts", "/expenses"],
    reports: [],
    home: { href: "/accounts", permission: "accounts:view" },
  },
  {
    key: "SALES",
    nameBn: "বিক্রয়",
    nameEn: "Sales",
    descriptionBn: "বিক্রয় ইনভয়েস, বিক্রয় ফেরত, বাকি বিক্রয়, ছাড় ও ভ্যাট — স্টক ও হিসাবে স্বয়ংক্রিয় পোস্টিং।",
    descriptionEn: "Sales invoices and returns, credit sales, discounts and VAT — posted to stock and books automatically.",
    icon: "🧾",
    tier: "FREE",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["sales:view", "auto_rice_mill.sales:view"], CREATE: ["sales:create", "auto_rice_mill.sales:create"], EDIT: ["sales:edit"], DELETE: ["sales:delete"], PRINT: ["sales:view"] },
    owns: ["sales:view", "sales:create", "sales:edit", "sales:delete", "auto_rice_mill.sales:view", "auto_rice_mill.sales:create"],
    routes: ["/vouchers/sales", "/vouchers/sales-return"],
    reports: ["daily-sales"],
    home: { href: "/vouchers/sales", permission: "sales:view" },
  },
  {
    key: "PURCHASE",
    nameBn: "ক্রয়",
    nameEn: "Purchase",
    descriptionBn: "ক্রয় ভাউচার ও ক্রয় ফেরত, সরবরাহকারীর বাকি, ব্যাচ ও মেয়াদসহ স্টক গ্রহণ।",
    descriptionEn: "Purchase vouchers and returns, supplier credit, stock receipt with batches and expiry.",
    icon: "🛒",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["purchases:view", "auto_rice_mill.procurement:view"], CREATE: ["purchases:create", "auto_rice_mill.procurement:create"], EDIT: ["purchases:edit", "auto_rice_mill.procurement:create"], DELETE: ["purchases:delete"], PRINT: ["purchases:view"] },
    owns: ["purchases:view", "purchases:create", "purchases:edit", "purchases:delete", "auto_rice_mill.procurement:view", "auto_rice_mill.procurement:create"],
    routes: ["/vouchers/purchase", "/vouchers/purchase-return", "/purchases/paddy"],
    reports: ["daily-purchase"],
    home: { href: "/vouchers/purchase", permission: "purchases:view" },
  },
  {
    key: "INVENTORY",
    nameBn: "ইনভেন্টরি (পণ্য ও স্টক)",
    nameEn: "Inventory",
    descriptionBn: "পণ্য তালিকা, ইউনিট, স্টক অবস্থা ও গুদামভিত্তিক মজুদ। বিক্রয়/ক্রয় ভাউচারে পণ্য বাছাই সবসময় চালু থাকে।",
    descriptionEn: "Product list, units, stock levels and per-warehouse quantities. Picking products in sales / purchase vouchers always works.",
    icon: "🏷",
    tier: "FREE",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["inventory:view", "auto_rice_mill.inventory:view"], CREATE: ["inventory:manage"], EDIT: ["inventory:manage"], DELETE: ["inventory:manage"], PRINT: ["inventory:view"] },
    owns: ["inventory:view", "inventory:manage", "auto_rice_mill.inventory:view"],
    routes: ["/products"],
    reports: [],
    home: { href: "/products", permission: "inventory:view" },
  },
  {
    key: "POS",
    nameBn: "পস (POS) বিক্রয়",
    nameEn: "Point of Sale (POS)",
    descriptionBn: "কাউন্টারে দ্রুত বিক্রয়: বারকোড স্ক্যান, একাধিক মাধ্যমে পরিশোধ, তাৎক্ষণিক রসিদ।",
    descriptionEn: "Fast counter sales: barcode scanning, split payments, instant receipts.",
    icon: "🏪",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["sales:view"], CREATE: ["sales:create"], PRINT: ["sales:view"] },
    owns: [],
    routes: ["/pos"],
    reports: [],
    home: { href: "/pos", permission: "sales:create" },
  },
  {
    key: "CUSTOMER",
    nameBn: "কাস্টমার",
    nameEn: "Customers",
    descriptionBn: "কাস্টমার তালিকা, লেজার, ক্রেডিট সীমা ও স্টেটমেন্ট।",
    descriptionEn: "Customer list, ledgers, credit limits and statements.",
    icon: "🙋",
    tier: "FREE",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["customers:view"], CREATE: ["customers:manage"], EDIT: ["customers:manage"], DELETE: ["customers:manage"] },
    owns: ["customers:view", "customers:manage"],
    routes: ["/customers"],
    reports: [],
    home: { href: "/customers", permission: "customers:view" },
  },
  {
    key: "SUPPLIER",
    nameBn: "সরবরাহকারী",
    nameEn: "Suppliers",
    descriptionBn: "সরবরাহকারী তালিকা, লেজার, দেনা ও পরিশোধ।",
    descriptionEn: "Supplier list, ledgers, payables and payments.",
    icon: "🚚",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["suppliers:view"], CREATE: ["suppliers:manage"], EDIT: ["suppliers:manage"], DELETE: ["suppliers:manage"] },
    owns: ["suppliers:view", "suppliers:manage"],
    routes: ["/suppliers", "/dues/suppliers"],
    reports: [],
    home: { href: "/suppliers", permission: "suppliers:view" },
  },
  {
    key: "MULTI_USER",
    nameBn: "মাল্টি ইউজার",
    nameEn: "Multi User",
    descriptionBn: "একাধিক ব্যবহারকারী, রোল ও অনুমতি। বন্ধ থাকলে শুধু মালিক ব্যবসায় প্রবেশ করতে পারবেন; অন্য ব্যবহারকারীর তথ্য মুছে যাবে না।",
    descriptionEn: "Several users with roles and permissions. When off, only the owner can open the business; other users are kept, not deleted.",
    icon: "👥",
    tier: "FREE",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["users:manage"], CREATE: ["users:manage", "roles:manage"], EDIT: ["users:manage", "roles:manage"], DELETE: ["users:manage", "roles:manage"] },
    owns: ["users:manage", "roles:manage"],
    routes: ["/users", "/roles"],
    reports: [],
    home: { href: "/users", permission: "users:manage" },
  },
  {
    key: "ADVANCED_REPORTING",
    nameBn: "অ্যাডভান্সড রিপোর্টিং",
    nameEn: "Advanced Reporting",
    descriptionBn: "দৈনিক সারসংক্ষেপ, নগদ প্রবাহ, আয়-ব্যয়, স্টক মূল্যায়ন, বিক্রয়-ক্রয় বিশ্লেষণ ও আদায় রিপোর্ট। মূল হিসাবের রিপোর্ট (লেজার, ট্রায়াল ব্যালেন্স, লাভ-ক্ষতি, ব্যালান্স শীট) সবসময় চালু।",
    descriptionEn: "Daily summary, cash flow, income & expense, stock valuation, sales/purchase analysis and collection reports. Core books (ledger, trial balance, P&L, balance sheet) stay on.",
    icon: "📊",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["reports:view"], EXPORT: ["reports:view"], PRINT: ["reports:view"] },
    owns: [],
    routes: [],
    reports: ["daily-summary", "cash-flow", "income-expense", "stock-valuation", "sales", "purchases", "collection"],
    home: { href: "/reports", permission: "reports:view" },
  },
  {
    key: "ADVANCED_INVENTORY",
    nameBn: "অ্যাডভান্সড ইনভেন্টরি",
    nameEn: "Advanced Inventory",
    descriptionBn: "স্টক জার্নাল (ঘাটতি/উদ্বৃত্ত সমন্বয়), ক্যাটাগরি ও ব্র্যান্ড ব্যবস্থাপনা। সাধারণ পণ্য, ইউনিট ও স্টক সবসময় চালু।",
    descriptionEn: "Stock journal (shortage / surplus adjustments), categories and brands. Basic products, units and stock stay on.",
    icon: "📦",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["inventory:view"], CREATE: ["stock:adjust", "inventory:manage"], EDIT: ["stock:adjust", "inventory:manage"], DELETE: ["stock:adjust"] },
    owns: ["stock:adjust"],
    routes: ["/vouchers/stock-journal", "/products/categories", "/products/brands"],
    reports: [],
    home: { href: "/vouchers/stock-journal", permission: "inventory:view" },
  },
  {
    key: "ADVANCED_CUSTOMER",
    nameBn: "অ্যাডভান্সড কাস্টমার ম্যানেজমেন্ট",
    nameEn: "Advanced Customer Management",
    descriptionBn: "বাকি ও আদায় ড্যাশবোর্ড, মেয়াদোত্তীর্ণ বকেয়া (এজিং), কাস্টমার বাকি রিপোর্ট ও কাস্টমার রিপোর্ট।",
    descriptionEn: "Dues & collection dashboard, overdue ageing, customer dues and customer summary reports.",
    icon: "🤝",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["customers:view"], EDIT: ["customers:manage"], EXPORT: ["reports:view"] },
    owns: [],
    routes: ["/dues/customers"],
    reports: ["customer-dues", "customers"],
    home: { href: "/dues/customers", permission: "customers:view" },
  },
  {
    key: "HRM",
    nameBn: "এইচআরএম (বেতন ও হাজিরা)",
    nameEn: "HRM (Payroll & Attendance)",
    descriptionBn: "কর্মচারী, বেতন কাঠামো, হাজিরা, ওভারটাইম, মাসিক বেতন, পে-স্লিপ, বেতন পরিশোধ ও অগ্রিম — সরাসরি হিসাবের খাতায় পোস্ট হয়।",
    descriptionEn: "Employees, salary structures, attendance, overtime, monthly payroll, payslips, salary payments and advances — posted to the books.",
    icon: "💼",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: {
      VIEW: ["payroll:view"], CREATE: ["payroll:manage", "payroll:attendance"], EDIT: ["payroll:manage", "payroll:attendance"], DELETE: ["payroll:manage"],
      EXPORT: ["payroll:view"], APPROVE: ["payroll:process", "payroll:pay"], PRINT: ["payroll:view"],
    },
    owns: ["payroll:view", "payroll:manage", "payroll:attendance", "payroll:process", "payroll:pay"],
    routes: ["/payroll"],
    reports: ["payroll-monthly", "payroll-employee-history", "payroll-payable", "payroll-payments", "payroll-department", "payroll-components"],
    home: { href: "/payroll", permission: "payroll:view" },
  },
  {
    key: "DAMAGE_STOCK",
    nameBn: "ড্যামেজ স্টক ইনভেন্টরি",
    nameEn: "Damage Stock Inventory",
    descriptionBn: "নষ্ট/ক্ষতিগ্রস্ত পণ্য আলাদা স্টকে রাখা, কারণসহ এন্ট্রি, সরবরাহকারীকে ফেরত ও ক্ষতির হিসাব।",
    descriptionEn: "Keep damaged goods in a separate stock with reasons, return them to suppliers and account for the loss.",
    icon: "🧯",
    tier: "PAID",
    status: "COMING_SOON",
    defaultEnabled: false,
    permissions: { VIEW: ["damage:view"], CREATE: ["damage:manage"], EDIT: ["damage:manage"], DELETE: ["damage:manage"], APPROVE: ["damage:approve"] },
    owns: [],
    routes: ["/damage"],
    reports: [],
  },
  {
    key: "PRODUCT_EXPIRY",
    nameBn: "পণ্যের মেয়াদ ব্যবস্থাপনা",
    nameEn: "Product Expiry Management",
    descriptionBn: "ব্যাচভিত্তিক মেয়াদ, মেয়াদোত্তীর্ণ ও শীঘ্রই মেয়াদ শেষের সতর্কবার্তা, FEFO, মেয়াদ রিপোর্ট ও মেয়াদোত্তীর্ণ স্টক বাতিল। বন্ধ থাকলেও ব্যাচের তথ্য সংরক্ষিত থাকে।",
    descriptionEn: "Batch-level expiry, expired / expiring alerts, FEFO, expiry reports and expired-stock write-off. Batch data is kept while off.",
    icon: "⏳",
    tier: "FREE",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["inventory:view"], EDIT: ["inventory:manage"], DELETE: ["stock:adjust"], EXPORT: ["reports:view"] },
    owns: [],
    routes: ["/products/batches"],
    reports: ["expired-stock", "expiring-stock", "expiry", "product-expiry", "expiry-value"],
    home: { href: "/products/batches", permission: "inventory:view" },
  },
  {
    key: "PRODUCTION",
    nameBn: "প্রোডাকশন ম্যানেজমেন্ট",
    nameEn: "Production Management",
    descriptionBn: "কাঁচামাল থেকে তৈরি পণ্য: রেসিপি (BOM), উৎপাদন এন্ট্রি, কাঁচামাল খরচ, বাই-প্রোডাক্ট (যেমন ধান → চাল, খুদ, কুঁড়া, তুষ), ফলন ও প্রসেস লস, উৎপাদন ব্যয় এবং স্বয়ংক্রিয় স্টক সমন্বয়।",
    descriptionEn: "Raw materials to finished goods: recipes (BOM), production entries, by-products (e.g. paddy → rice, broken rice, bran, husk), yield and process loss, production cost and automatic stock adjustment.",
    icon: "🏭",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["production:view", "auto_rice_mill.milling:view"], CREATE: ["production:manage", "auto_rice_mill.milling:create"], EDIT: ["production:manage", "auto_rice_mill.milling:create"], DELETE: ["production:manage", "auto_rice_mill.milling:create"], PRINT: ["production:view"] },
    owns: ["production:view", "production:manage", "auto_rice_mill.milling:view", "auto_rice_mill.milling:create"],
    routes: ["/production"],
    reports: [],
    home: { href: "/production", permission: "production:view" },
  },
  {
    key: "MEMO_ENTRY",
    nameBn: "মেমো এন্ট্রি",
    nameEn: "Memo Entry",
    descriptionBn: "দ্রুত কাঁচা মেমো/চালান এন্ট্রি, পরে যাচাই করে বিক্রয় বা ক্রয় ভাউচারে রূপান্তর।",
    descriptionEn: "Quick rough memo / challan entry, verified and converted to sales or purchase vouchers later.",
    icon: "📝",
    tier: "FREE",
    status: "COMING_SOON",
    defaultEnabled: false,
    permissions: { VIEW: ["memo:view"], CREATE: ["memo:manage"], EDIT: ["memo:manage"], DELETE: ["memo:manage"], APPROVE: ["memo:approve"] },
    owns: [],
    routes: ["/memos"],
    reports: [],
  },
  {
    key: "SERVICE_ORDER",
    nameBn: "সার্ভিস অর্ডার ম্যানেজমেন্ট",
    nameEn: "Service Order Management",
    descriptionBn: "মেরামত/সার্ভিস অর্ডার গ্রহণ, অবস্থা ট্র্যাকিং, যন্ত্রাংশ ও সার্ভিস চার্জ, ডেলিভারি ও বিল।",
    descriptionEn: "Repair / service orders: intake, status tracking, parts and service charges, delivery and billing.",
    icon: "🛠️",
    tier: "PAID",
    status: "COMING_SOON",
    defaultEnabled: false,
    permissions: { VIEW: ["service:view"], CREATE: ["service:manage"], EDIT: ["service:manage"], DELETE: ["service:manage"], APPROVE: ["service:approve"] },
    owns: [],
    routes: ["/service-orders"],
    reports: [],
  },
  {
    key: "SALES_PARTNER",
    nameBn: "সেলস পার্টনার / কমিশন এজেন্ট",
    nameEn: "Sales Partner / Commission Agent",
    descriptionBn: "বিক্রয় প্রতিনিধি ও এজেন্ট, বিক্রয়ভিত্তিক কমিশন হিসাব ও কমিশন পরিশোধ।",
    descriptionEn: "Sales representatives and agents, commission on sales and commission payments.",
    icon: "🧾",
    tier: "PAID",
    status: "COMING_SOON",
    defaultEnabled: false,
    permissions: { VIEW: ["partners:view"], CREATE: ["partners:manage"], EDIT: ["partners:manage"], DELETE: ["partners:manage"], EXPORT: ["partners:view"], APPROVE: ["partners:approve"] },
    owns: [],
    routes: ["/partners"],
    reports: [],
  },
  {
    key: "POINT_MANAGEMENT",
    nameBn: "পয়েন্ট ম্যানেজমেন্ট",
    nameEn: "Point Management",
    descriptionBn: "কাস্টমার লয়্যালটি পয়েন্ট: কেনাকাটায় পয়েন্ট অর্জন ও পরবর্তী বিক্রয়ে ব্যবহার।",
    descriptionEn: "Customer loyalty points: earn on purchases, redeem on later sales.",
    icon: "⭐",
    tier: "PAID",
    status: "COMING_SOON",
    defaultEnabled: false,
    permissions: { VIEW: ["points:view"], EDIT: ["points:manage"], APPROVE: ["points:approve"] },
    owns: [],
    routes: ["/points"],
    reports: [],
  },
  {
    key: "MULTI_WAREHOUSE",
    nameBn: "মাল্টি ওয়্যারহাউস",
    nameEn: "Multi Warehouse",
    descriptionBn: "একাধিক গুদাম, গুদামভিত্তিক স্টক ও লেনদেন। বন্ধ থাকলে নতুন লেনদেন প্রধান গুদামে হবে; আগের গুদামের স্টক ও তথ্য অপরিবর্তিত থাকবে।",
    descriptionEn: "Several warehouses with per-warehouse stock and transactions. When off, new entries use the main warehouse; existing stock stays as it is.",
    icon: "🏬",
    tier: "PAID",
    status: "AVAILABLE",
    defaultEnabled: true,
    permissions: { VIEW: ["inventory:view"], CREATE: ["inventory:manage"], EDIT: ["inventory:manage"], DELETE: ["inventory:manage"] },
    owns: [],
    routes: [],
    reports: [],
    home: { href: "/products/stock", permission: "inventory:view" },
  },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const FEATURE_KEYS = FEATURES.map((f) => f.key) as FeatureKey[];
export const isFeatureKey = (v: string): v is FeatureKey => (FEATURE_KEYS as string[]).includes(v);
export const featureDef = (key: FeatureKey): FeatureDef => FEATURES.find((f) => f.key === key)!;

/** The feature a page or report belongs to (null = core, always on). */
export function featureForPath(path: string | null | undefined): FeatureKey | null {
  if (!path) return null;
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  const m = /^\/reports\/([^/]+)$/.exec(clean) ?? /^\/api\/reports\/([^/]+)$/.exec(clean);
  // the most specific route wins: /products/batches → PRODUCT_EXPIRY, /products → INVENTORY
  let best: { key: FeatureKey; len: number } | null = null;
  for (const f of FEATURES as readonly FeatureDef[]) {
    if (m && f.reports.includes(m[1])) return f.key as FeatureKey;
    for (const r of f.routes) {
      if ((clean === r || clean.startsWith(`${r}/`)) && (!best || r.length > best.len)) best = { key: f.key as FeatureKey, len: r.length };
    }
  }
  return best?.key ?? null;
}

/** Permissions that must be refused while the given features are off. */
export function blockedPermissions(disabled: Iterable<string>): Permission[] {
  const off = new Set(disabled);
  return (FEATURES as readonly FeatureDef[]).filter((f) => off.has(f.key)).flatMap((f) => f.owns);
}

/** The feature that owns a permission (role editor: grey out permissions of switched-off modules). */
export function ownerFeature(permission: string): FeatureKey | null {
  return ((FEATURES as readonly FeatureDef[]).find((f) => (f.owns as string[]).includes(permission))?.key as FeatureKey) ?? null;
}
