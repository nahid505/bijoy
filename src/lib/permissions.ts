// Permission catalogue. Keys are stored on Role.permissions; "*" grants everything.

export const PERMISSION_GROUPS = [
  {
    label: "ড্যাশবোর্ড ও রিপোর্ট",
    permissions: [
      { key: "dashboard:view", label: "ড্যাশবোর্ড দেখা" },
      { key: "reports:view", label: "রিপোর্ট দেখা ও এক্সপোর্ট" },
    ],
  },
  {
    label: "বিক্রয় ও বিক্রয় ফেরত",
    permissions: [
      { key: "sales:view", label: "বিক্রয় দেখা" },
      { key: "sales:create", label: "বিক্রয় তৈরি" },
      { key: "sales:edit", label: "বিক্রয় সম্পাদনা" },
      { key: "sales:delete", label: "বিক্রয় মুছা" },
    ],
  },
  {
    label: "ক্রয় ও ক্রয় ফেরত",
    permissions: [
      { key: "purchases:view", label: "ক্রয় দেখা" },
      { key: "purchases:create", label: "ক্রয় তৈরি" },
      { key: "purchases:edit", label: "ক্রয় সম্পাদনা" },
      { key: "purchases:delete", label: "ক্রয় মুছা" },
    ],
  },
  {
    label: "রিসিপ্ট, পেমেন্ট ও জার্নাল",
    permissions: [
      { key: "vouchers:view", label: "ভাউচার দেখা" },
      { key: "vouchers:create", label: "ভাউচার তৈরি" },
      { key: "vouchers:edit", label: "ভাউচার সম্পাদনা" },
      { key: "vouchers:delete", label: "ভাউচার মুছা" },
    ],
  },
  {
    label: "সাধারণ অনুমতি (লেনদেন)",
    permissions: [
      {
        key: "transaction:change_date",
        label: "লেনদেনের তারিখ পরিবর্তন করার অনুমতি (পেছনের/সামনের তারিখে এন্ট্রি)",
        hint: "না থাকলে বিক্রয়, ক্রয়, ফেরত, রিসিপ্ট, পেমেন্ট, খরচ, জার্নাল, স্টক জার্নাল, ধান ক্রয়, উৎপাদন ও বেতন পরিশোধে তারিখ লক থাকবে — নতুন এন্ট্রি শুধু আজকের তারিখে, আর সম্পাদনায় আগের তারিখই থাকবে",
      },
    ],
  },
  {
    label: "হিসাব (লেজার)",
    permissions: [
      { key: "accounts:view", label: "লেজার ও হিসাব দেখা" },
      { key: "accounts:manage", label: "হিসাব খাত ব্যবস্থাপনা" },
    ],
  },
  {
    label: "পণ্য ও মজুদ",
    permissions: [
      { key: "inventory:view", label: "পণ্য ও স্টক দেখা" },
      { key: "inventory:manage", label: "পণ্য, ক্যাটাগরি, ব্র্যান্ড, ইউনিট ব্যবস্থাপনা" },
      { key: "stock:adjust", label: "স্টক জার্নাল (সমন্বয়)" },
    ],
  },
  {
    label: "কাস্টমার ও সরবরাহকারী",
    permissions: [
      { key: "customers:view", label: "কাস্টমার দেখা" },
      { key: "customers:manage", label: "কাস্টমার ব্যবস্থাপনা" },
      { key: "suppliers:view", label: "সরবরাহকারী দেখা" },
      { key: "suppliers:manage", label: "সরবরাহকারী ব্যবস্থাপনা" },
      // restrictions, not grants: they apply only when ticked explicitly (never through "*" / the Owner)
      {
        key: "customers:assigned_only",
        label: "শুধু নির্ধারিত কাস্টমার দেখতে পারবে",
        hint: "টিক দিলে এই রোলের ব্যবহারকারী শুধু তার জন্য নির্ধারিত কাস্টমারদের তথ্য, বিক্রয়, লেজার ও রিপোর্ট দেখবেন (ব্যবহারকারী সম্পাদনা পেজে কাস্টমার নির্ধারণ করুন)",
      },
      {
        key: "suppliers:assigned_only",
        label: "শুধু নির্ধারিত সরবরাহকারী দেখতে পারবে",
        hint: "টিক দিলে শুধু নির্ধারিত সরবরাহকারীদের তথ্য, ক্রয়, লেজার ও রিপোর্ট দেখা যাবে",
      },
    ],
  },
  {
    // salary data is sensitive: none of these is part of any default role except the Owner
    label: "বেতন (Payroll)",
    permissions: [
      { key: "payroll:view", label: "কর্মচারী, বেতন, পে-স্লিপ ও বেতন রিপোর্ট দেখা" },
      { key: "payroll:manage", label: "কর্মচারী, বেতন কাঠামো, উপাদান ও বেতন সেটিং ব্যবস্থাপনা" },
      { key: "payroll:attendance", label: "হাজিরা ও ওভারটাইম এন্ট্রি (বেতন দেখা ছাড়া)" },
      { key: "payroll:process", label: "মাসিক বেতন হিসাব, পোস্ট (চূড়ান্ত) ও পোস্টিং বাতিল" },
      { key: "payroll:pay", label: "বেতন পরিশোধ এবং অগ্রিম/ঋণ প্রদান" },
    ],
  },
  {
    label: "এসএমএস",
    permissions: [
      { key: "sms:view", label: "এসএমএস ড্যাশবোর্ড ও লগ দেখা" },
      { key: "sms:send", label: "একক / নির্বাচিত কাস্টমারকে এসএমএস পাঠানো" },
      { key: "sms:bulk", label: "বাল্ক ও গ্রুপ এসএমএস পাঠানো" },
      { key: "sms:manage", label: "এসএমএস সেটিং ও টেমপ্লেট" },
    ],
  },
  {
    label: "প্রশাসন",
    permissions: [
      { key: "users:manage", label: "ব্যবহারকারী ব্যবস্থাপনা" },
      { key: "roles:manage", label: "রোল ও অনুমতি ব্যবস্থাপনা" },
      { key: "business:manage", label: "ব্যবসা সেটিং" },
      { key: "backup:manage", label: "ব্যাকআপ" },
      { key: "audit:view", label: "অডিট লগ দেখা" },
    ],
  },
  {
    label: "উৎপাদন (রেসিপি / BOM)",
    permissions: [
      { key: "production:view", label: "রেসিপি, উৎপাদন এন্ট্রি ও উৎপাদন ব্যয় দেখা" },
      { key: "production:manage", label: "রেসিপি এবং উৎপাদন এন্ট্রি তৈরি, সম্পাদনা ও মুছা" },
    ],
  },
  {
    // business type DEPOT only (the role form hides the group elsewhere). A role with only these keys works the
    // depot alone: depot dashboard, challans, stock in, market collection and depot reports — no ledgers,
    // general vouchers, profit & loss or settings. Where each one opens: DEPOT_ACCESS in src/lib/depot.ts.
    label: "ডিপো ব্যবস্থাপনা",
    depotOnly: true,
    permissions: [
      { key: "depot:view", label: "ডিপো ড্যাশবোর্ড ও চালান দেখা", hint: "ডিপো ড্যাশবোর্ড, ডেলিভারি চালান তালিকা, চালান প্রিন্ট ও ডেলিভারি রেজিস্টার" },
      { key: "depot:delivery_manage", label: "ডেলিভারি চালান তৈরি ও সম্পাদনা", hint: "ডিও রিলিজ ও মার্কেট সেলস চালান তৈরি, সম্পাদনা ও মুছা" },
      { key: "depot:stock_in", label: "স্টক ইন — কোম্পানি থেকে প্রাপ্তি", hint: "কোম্পানি থেকে পণ্য গ্রহণ (ফ্রি সহ) এন্ট্রি ও দেখা" },
      { key: "depot:collection_create", label: "মার্কেট কালেকশন এন্ট্রি", hint: "ডিলারদের কাছ থেকে টাকা আদায় এবং কোম্পানির কমিশন আদায়/সমন্বয়" },
      { key: "depot:reports_view", label: "কোম্পানি কমিশন ও মার্কেট বাকি রিপোর্ট দেখা", hint: "কোম্পানি কমিশন হিসাব ও রিপোর্ট, রুটভিত্তিক মার্কেট বাকি" },
      { key: "depot:scheme_manage", label: "ফ্রি স্কিম রিপোর্ট দেখা ও ব্যবস্থাপনা", hint: "কোম্পানি থেকে প্রাপ্ত ও ডিলারদের দেওয়া ফ্রি পণ্যের হিসাব" },
    ],
  },
  {
    label: "সাবস্ক্রিপশন ও বিলিং",
    permissions: [
      { key: "billing:view", label: "প্ল্যান, মেয়াদ, পেমেন্ট ও ইনভয়েস দেখা" },
      { key: "billing:manage", label: "প্ল্যান আপগ্রেড, নবায়ন ও পেমেন্ট করা" },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

/**
 * "!key" entries block a permission even for "*" — used for permissions of switched-off features
 * (see src/lib/features.ts), so every existing check refuses them without further changes.
 */
export function hasPermission(granted: readonly string[], required: Permission | readonly Permission[]): boolean {
  // a list means "any of these" (e.g. a depot page: the depot permission or the general one)
  if (typeof required !== "string") return required.some((r) => hasPermission(granted, r));
  if (granted.includes(`!${required}`)) return false;
  return granted.includes("*") || granted.includes(required);
}

/** The depot permission group's keys (business type DEPOT only). */
export const DEPOT_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => ("depotOnly" in g && g.depotOnly ? g.permissions.map((p) => p.key) : []));
