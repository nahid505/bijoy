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
    label: "ফিচার ও মডিউল",
    permissions: [
      { key: "features:view", label: "ফিচার তালিকা ও পরিবর্তনের ইতিহাস দেখা" },
      { key: "features:manage", label: "ফিচার চালু / বন্ধ করা" },
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
export function hasPermission(granted: readonly string[], required: Permission): boolean {
  if (granted.includes(`!${required}`)) return false;
  return granted.includes("*") || granted.includes(required);
}
