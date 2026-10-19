import type { Permission } from "./permissions";
import { DEPOT_ACCESS } from "./depot";

export interface NavLink {
  href: string;
  label: string;
  /** a list means "any of these" */
  permission: Permission | readonly Permission[];
}

export interface NavEntry {
  key: string;
  label: string;
  icon: string; // inline SVG path data (24×24, stroke)
  href?: string;
  permission?: Permission | readonly Permission[];
  children?: NavLink[];
  /** shown only for these business types (e.g. ["DEPOT"]) */
  businessTypes?: string[];
  /** emphasised and open by default */
  highlight?: boolean;
}

// Simple stroke icons (original artwork) — rendered by the sidebar.
const I = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  book: "M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3V4zm0 13a3 3 0 013-3h11",
  box: "M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0",
  truck: "M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8zm-7 10a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-5-6",
  store: "M3 9l2-5h14l2 5M3 9h18v11H3zM9 20v-6h6v6",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zm8-3l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z",
  baki: "M12 3v18M7 7h7a3 3 0 010 6H8a3 3 0 000 6h9",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6",
  sms: "M4 5h16v11H8l-4 4V5zm4 5h8M8 13h5",
  wallet: "M3 7h15a3 3 0 013 3v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0l12-4v4M16 14h2",
  puzzle: "M10 3h4v3a2 2 0 104 0V5h3v5h-1a2 2 0 100 4h1v7h-6v-1a2 2 0 10-4 0v1H4v-6h1a2 2 0 100-4H4V5h6V3z",
  factory: "M3 21V10l5 3V10l5 3V7l5 3V3h3v18H3zm4-4h2m4 0h2m4 0h0",
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
};

export const NAV: NavEntry[] = [
  { key: "dashboard", label: "ড্যাশবোর্ড", icon: I.home, href: "/dashboard", permission: ["dashboard:view", "depot:view"] },
  {
    key: "depot",
    label: "ডিপো ব্যবস্থাপনা",
    icon: I.truck,
    businessTypes: ["DEPOT"],
    highlight: true,
    children: [
      { href: "/depot/deliveries", label: "ডেলিভারি চালান", permission: DEPOT_ACCESS.view },
      { href: "/depot/deliveries/new", label: "ডেলিভারি চালান তৈরি", permission: DEPOT_ACCESS.deliveryCreate },
      { href: "/depot/dealers", label: "ডিলার তালিকা", permission: DEPOT_ACCESS.dealersView },
      { href: "/depot/stock-in", label: "স্টক ইন (কোম্পানি থেকে প্রাপ্তি)", permission: DEPOT_ACCESS.stockInView },
      { href: "/depot/collections", label: "মার্কেট কালেকশন", permission: DEPOT_ACCESS.collectionView },
      { href: "/depot/payments", label: "কোম্পানিকে পেমেন্ট", permission: DEPOT_ACCESS.paymentView },
      { href: "/depot/stock-adjust", label: "স্টক সমন্বয় (ডিপো)", permission: DEPOT_ACCESS.stockAdjust },
      { href: "/depot/expenses", label: "ডিপো খরচ", permission: DEPOT_ACCESS.expense },
      { href: "/depot/commission", label: "কোম্পানি কমিশন হিসাব", permission: DEPOT_ACCESS.commission },
      { href: "/reports/depot-market-dues", label: "রুটভিত্তিক মার্কেট বাকি", permission: DEPOT_ACCESS.reports },
      { href: "/reports/depot-commission", label: "কোম্পানি কমিশন রিপোর্ট", permission: DEPOT_ACCESS.reports },
      { href: "/reports/depot-deliveries", label: "ডেলিভারি রেজিস্টার", permission: DEPOT_ACCESS.register },
      { href: "/reports/depot-free", label: "ফ্রি স্কিম রিপোর্ট", permission: DEPOT_ACCESS.scheme },
      { href: "/reports/depot-company-ledger", label: "কোম্পানি লেজার (ডিপো)", permission: DEPOT_ACCESS.companyLedger },
      { href: "/reports/depot-profit-loss", label: "ডিপো লাভ-ক্ষতি", permission: DEPOT_ACCESS.profitLoss },
      { href: "/reports/depot-cash-book", label: "ডিপো ক্যাশ বুক", permission: DEPOT_ACCESS.cashbook },
    ],
  },
  { key: "pos", label: "পস বিক্রয়", icon: I.receipt, href: "/pos", permission: "sales:create" },
  {
    key: "transactions",
    label: "লেনদেন",
    icon: I.swap,
    children: [
      { href: "/vouchers/receipt", label: "রিসিপ্ট", permission: "vouchers:view" },
      { href: "/vouchers/payment", label: "পেমেন্ট", permission: "vouchers:view" },
      { href: "/vouchers/journal", label: "জার্নাল", permission: "vouchers:view" },
      { href: "/vouchers/sales", label: "বিক্রয়", permission: "sales:view" },
      { href: "/vouchers/purchase", label: "ক্রয়", permission: "purchases:view" },
      { href: "/purchases/paddy", label: "ধান ক্রয় (ওজন স্লিপ)", permission: "purchases:view" },
      { href: "/vouchers/sales-return", label: "বিক্রয় ফেরত", permission: "sales:view" },
      { href: "/vouchers/purchase-return", label: "ক্রয় ফেরত", permission: "purchases:view" },
      { href: "/vouchers/stock-journal", label: "স্টক জার্নাল", permission: "inventory:view" },
    ],
  },
  {
    key: "accounts",
    label: "হিসাব",
    icon: I.book,
    children: [
      { href: "/accounts", label: "লেজার", permission: "accounts:view" },
      { href: "/accounts/cash", label: "ক্যাশ", permission: "accounts:view" },
      { href: "/accounts/bank", label: "ব্যাংক", permission: "accounts:view" },
      { href: "/accounts/debtors", label: "দেনাদার", permission: "accounts:view" },
      { href: "/accounts/creditors", label: "পাওনাদার", permission: "accounts:view" },
    ],
  },
  {
    key: "products",
    label: "পণ্য",
    icon: I.box,
    children: [
      { href: "/products", label: "সকল পণ্য", permission: "inventory:view" },
      { href: "/products/categories", label: "ক্যাটাগরি", permission: "inventory:view" },
      { href: "/products/brands", label: "ব্র্যান্ড", permission: "inventory:view" },
      { href: "/products/units", label: "ইউনিট", permission: "inventory:view" },
      { href: "/products/stock", label: "স্টক", permission: "inventory:view" },
      { href: "/products/batches", label: "ব্যাচ ও মেয়াদ", permission: "inventory:view" },
      { href: "/notifications", label: "নোটিফিকেশন", permission: "inventory:view" },
    ],
  },
  { key: "customers", label: "কাস্টমার", icon: I.user, href: "/customers", permission: "customers:view" },
  { key: "suppliers", label: "সরবরাহকারী", icon: I.truck, href: "/suppliers", permission: "suppliers:view" },
  {
    key: "dues",
    label: "বাকি ও আদায়",
    icon: I.baki,
    children: [
      { href: "/dues/customers", label: "কাস্টমার বাকি", permission: "customers:view" },
      { href: "/dues/suppliers", label: "সরবরাহকারী দেনা", permission: "suppliers:view" },
      { href: "/vouchers/receipt/new", label: "টাকা আদায়", permission: "vouchers:create" },
      { href: "/vouchers/payment/new", label: "সরবরাহকারীকে পরিশোধ", permission: "vouchers:create" },
    ],
  },
  { key: "expenses", label: "খরচ", icon: I.swap, href: "/expenses", permission: "vouchers:view" },
  {
    key: "production",
    label: "উৎপাদন ব্যবস্থাপনা",
    icon: I.factory,
    children: [
      { href: "/production", label: "উৎপাদন ড্যাশবোর্ড", permission: "production:view" },
      { href: "/production/new", label: "নতুন উৎপাদন", permission: "production:manage" },
      { href: "/production/recipes", label: "রেসিপি (BOM)", permission: "production:view" },
    ],
  },
  {
    key: "payroll",
    label: "বেতন",
    icon: I.wallet,
    children: [
      { href: "/payroll", label: "বেতন ড্যাশবোর্ড", permission: "payroll:view" },
      { href: "/payroll/employees", label: "কর্মচারী", permission: "payroll:view" },
      { href: "/payroll/attendance", label: "হাজিরা", permission: "payroll:attendance" },
      { href: "/payroll/runs", label: "মাসিক বেতন", permission: "payroll:view" },
      { href: "/payroll/payments", label: "বেতন পরিশোধ", permission: "payroll:view" },
      { href: "/payroll/advances", label: "অগ্রিম ও ঋণ", permission: "payroll:view" },
      { href: "/payroll/reports", label: "বেতন রিপোর্ট", permission: "payroll:view" },
      { href: "/payroll/settings", label: "বেতন সেটিং", permission: "payroll:manage" },
    ],
  },
  {
    key: "reports",
    label: "রিপোর্ট",
    icon: I.chart,
    children: [
      { href: "/reports/daily-cash", label: "ডেইলী জমা-খরচ হিসাব", permission: "accounts:view" },
      { href: "/reports/daily-sales", label: "ডেইলি বিক্রয় রিপোর্ট", permission: "sales:view" },
      { href: "/reports/daily-purchase", label: "ডেইলি ক্রয় রিপোর্ট", permission: "purchases:view" },
      { href: "/reports/daily-summary", label: "দৈনিক সারসংক্ষেপ", permission: "reports:view" },
      { href: "/reports/day-book", label: "ডে বুক", permission: "reports:view" },
      { href: "/reports/ledger", label: "লেজার রিপোর্ট", permission: "reports:view" },
      { href: "/reports/trial-balance", label: "ট্রায়াল ব্যালেন্স", permission: "reports:view" },
      { href: "/reports/profit-loss", label: "লাভ-ক্ষতি", permission: "reports:view" },
      { href: "/reports/balance-sheet", label: "ব্যালান্স শীট", permission: "reports:view" },
      { href: "/reports/cash-flow", label: "নগদ প্রবাহ", permission: "reports:view" },
      { href: "/reports/stock", label: "স্টক রিপোর্ট", permission: "reports:view" },
      { href: "/reports/stock-valuation", label: "স্টক মূল্যায়ন", permission: "reports:view" },
      { href: "/reports/expiry-value", label: "মেয়াদ রিপোর্ট", permission: "reports:view" },
      { href: "/reports/customers", label: "কাস্টমার রিপোর্ট", permission: "reports:view" },
      { href: "/reports/suppliers", label: "সরবরাহকারী রিপোর্ট", permission: "reports:view" },
      { href: "/reports/sales", label: "বিক্রয় রিপোর্ট", permission: "reports:view" },
      { href: "/reports/purchases", label: "ক্রয় রিপোর্ট", permission: "reports:view" },
      { href: "/reports/collection", label: "আদায় রিপোর্ট", permission: "reports:view" },
      { href: "/reports/expenses", label: "খরচ রিপোর্ট", permission: "reports:view" },
      { href: "/reports/income-expense", label: "আয়-ব্যয় রিপোর্ট", permission: "reports:view" },
      { href: "/reports/integrity", label: "হিসাব যাচাই", permission: "reports:view" },
    ],
  },
  {
    key: "sms",
    label: "এসএমএস",
    icon: I.sms,
    children: [
      { href: "/sms", label: "এসএমএস ড্যাশবোর্ড", permission: "sms:view" },
      { href: "/sms/compose", label: "এসএমএস পাঠান", permission: "sms:send" },
      { href: "/sms/log", label: "এসএমএস লগ", permission: "sms:view" },
      { href: "/sms/templates", label: "এসএমএস টেমপ্লেট", permission: "sms:manage" },
      { href: "/sms/settings", label: "এসএমএস সেটিং", permission: "sms:manage" },
    ],
  },
  {
    key: "users",
    label: "ব্যবহারকারী",
    icon: I.users,
    children: [
      { href: "/users", label: "ব্যবহারকারী তালিকা", permission: "users:manage" },
      { href: "/roles", label: "রোল ও অনুমতি", permission: "roles:manage" },
      { href: "/audit-logs", label: "অডিট লগ", permission: "audit:view" },
    ],
  },
  { key: "billing", label: "সাবস্ক্রিপশন", icon: I.receipt, href: "/billing", permission: "billing:view" },
  { key: "business", label: "ব্যবসা সেটিং", icon: I.store, href: "/business", permission: "business:manage" },
  { key: "account", label: "অ্যাকাউন্ট সেটিং", icon: I.gear, href: "/account" },
  { key: "backup", label: "ব্যাকআপ", icon: I.db, href: "/backup", permission: "backup:manage" },
];

/** Mobile bottom bar — the most frequent destinations. */
export const MOBILE_TABS = [
  { href: "/dashboard", label: "হোম", icon: I.home, permission: ["dashboard:view", "depot:view"] as Permission | readonly Permission[] },
  { href: "/pos", label: "বিক্রয়", icon: I.receipt, permission: "sales:create" as Permission },
  { href: "/vouchers/receipt/new", label: "রিসিপ্ট", icon: I.book, permission: "vouchers:create" as Permission },
  { href: "/reports/day-book", label: "রিপোর্ট", icon: I.chart, permission: "reports:view" as Permission },
];
