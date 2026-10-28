// Notifications are stored as text in Bangla (they are created by the daily check and the billing jobs, often with no
// user present). In English, localizeNotification turns a stored title / message into English when it matches a known
// shape — the names, numbers and dates inside it are kept (plan names are switched to their English name). Text of
// any other shape is shown as stored. Digits and month names are made English on screen by EnglishScreen (src/components/digit-display.tsx).
//
// Every rule mirrors one template in src/server/services/notifications.ts or subscriptions.ts; tests/notification-text
// checks the two stay in step.

type Rule = [RegExp, (m: RegExpMatchArray, plan: (bn: string) => string) => string];

const RULES: Rule[] = [
  // ── stock and expiry (notifications.ts)
  [/^মেয়াদোত্তীর্ণ: (.+)$/, (m) => `Expired: ${m[1]}`],
  [/^আজ মেয়াদ শেষ: (.+)$/, (m) => `Expires today: ${m[1]}`],
  [/^(\S+) দিনের মধ্যে মেয়াদ শেষ: (.+)$/, (m) => `Expires within ${m[1]} days: ${m[2]}`],
  [/^(.+) — ব্যাচ (.+) এর মেয়াদ (.+) তারিখে শেষ হয়েছে। মজুদ (.+)।$/, (m) => `${m[1]} — batch ${m[2]} expired on ${m[3]}. Stock ${m[4]}.`],
  [/^(.+) — ব্যাচ (.+) এর মেয়াদ আজ \((.+)\) শেষ হচ্ছে। মজুদ (.+)।$/, (m) => `${m[1]} — batch ${m[2]} expires today (${m[3]}). Stock ${m[4]}.`],
  [/^(.+) — ব্যাচ (.+) এর মেয়াদ (\S+) দিন পর \((.+)\) শেষ হবে। মজুদ (.+)।$/, (m) => `${m[1]} — batch ${m[2]} expires in ${m[3]} days (${m[4]}). Stock ${m[5]}.`],
  [/^ডিপো — স্টক শেষ: (.+)$/, (m) => `Depot — out of stock: ${m[1]}`],
  [/^ডিপো — কম স্টক: (.+)$/, (m) => `Depot — low stock: ${m[1]}`],
  [/^স্টক শেষ: (.+)$/, (m) => `Out of stock: ${m[1]}`],
  [/^কম স্টক: (.+)$/, (m) => `Low stock: ${m[1]}`],
  [/^(.+) — মজুদ (.+), সর্বনিম্ন সীমা (.+)।$/, (m) => `${m[1]} — stock ${m[2]}, minimum ${m[3]}.`],
  [/^বকেয়া মেয়াদোত্তীর্ণ: (.+)$/, (m) => `Overdue dues: ${m[1]}`],
  [/^(.+) — (.+) বকেয়া পরিশোধের তারিখ পেরিয়ে গেছে \(সবচেয়ে পুরনো (\S+) দিন\)।$/, (m) => `${m[1]} — ${m[2]} is past its due date (oldest ${m[3]} days).`],
  // ── subscription (subscriptions.ts)
  [/^রেজিস্ট্রেশন সফল — (\S+) দিনের ফ্রি ট্রায়াল শুরু$/, (m) => `Registration successful — ${m[1]}-day free trial started`],
  [/^রেজিস্ট্রেশন সফল — (.+) প্ল্যান$/, (m, p) => `Registration successful — ${p(m[1])} plan`],
  [/^(.+) প্ল্যানের সব ফিচার (.+) পর্যন্ত ফ্রি ব্যবহার করুন। এরপর প্ল্যান নির্বাচন করে পেমেন্ট করলে সব চালু থাকবে।$/, (m, p) => `Use every feature of the ${p(m[1])} plan free until ${m[2]}. Then choose a plan and pay to keep everything on.`],
  [/^(.+) প্ল্যান চালু হয়েছে।$/, (m, p) => `The ${p(m[1])} plan is on.`],
  [/^প্ল্যান আপগ্রেড: (.+)$/, (m, p) => `Plan upgraded: ${p(m[1])}`],
  [/^প্ল্যান ডাউনগ্রেড: (.+)$/, (m, p) => `Plan downgraded: ${p(m[1])}`],
  [/^প্ল্যান পরিবর্তন: (.+)$/, (m, p) => `Plan changed: ${p(m[1])}`],
  [/^(.+) → (.+) \(মেয়াদ (.+) পর্যন্ত\)$/, (m, p) => `${p(m[1])} → ${p(m[2])} (until ${m[3]})`],
  [/^পেমেন্ট সফল — (.+)$/, (m, p) => `Payment successful — ${p(m[1])}`],
  [/^(.+) পরিশোধ হয়েছে \((.+)\)। মেয়াদ (.+) পর্যন্ত। ইনভয়েস (.+)।$/, (m) => `${m[1]} paid (${m[2]}). Valid until ${m[3]}. Invoice ${m[4]}.`],
  [/^সাবস্ক্রিপশন চালু হয়েছে — (.+)$/, (m, p) => `Subscription activated — ${p(m[1])}`],
  [/^সাবস্ক্রিপশন নবায়ন হয়েছে — (.+)$/, (m, p) => `Subscription renewed — ${p(m[1])}`],
  [/^প্ল্যান আপগ্রেড হয়েছে — (.+)$/, (m, p) => `Plan upgraded — ${p(m[1])}`],
  [/^প্ল্যান ডাউনগ্রেড হয়েছে — (.+)$/, (m, p) => `Plan downgraded — ${p(m[1])}`],
  [/^প্ল্যান পরিবর্তন হয়েছে — (.+)$/, (m, p) => `Plan changed — ${p(m[1])}`],
  [/^(.+) প্ল্যান (.+) পর্যন্ত সক্রিয়। প্ল্যানের সব ফিচার চালু হয়েছে।$/, (m, p) => `The ${p(m[1])} plan is active until ${m[2]}. Every feature of the plan is on.`],
  [/^পেমেন্ট বাতিল — (.+)$/, (m, p) => `Payment cancelled — ${p(m[1])}`],
  [/^পেমেন্ট ব্যর্থ — (.+)$/, (m, p) => `Payment failed — ${p(m[1])}`],
  [/^(.+) পেমেন্ট সম্পন্ন হয়নি: (.+)$/, (m) => `${m[1]} payment not completed: ${m[2]}`],
  [/^ট্রায়াল শেষ হবে (\S+) দিন পর$/, (m) => `Trial ends in ${m[1]} days`],
  [/^সাবস্ক্রিপশন শেষ হবে (\S+) দিন পর$/, (m) => `Subscription ends in ${m[1]} days`],
  [/^(.+) প্ল্যানের মেয়াদ (.+) তারিখে শেষ হবে। নবায়ন না করলে অতিরিক্ত ফিচার বন্ধ হবে \(তথ্য মুছে যাবে না\)।$/, (m, p) => `The ${p(m[1])} plan ends on ${m[2]}. Renew, or the extra features will be switched off (no data is deleted).`],
  [/^ট্রায়াল এর মেয়াদ শেষ$/, () => "Trial has ended"],
  [/^সাবস্ক্রিপশন এর মেয়াদ শেষ$/, () => "Subscription has ended"],
  [/^(.+) প্ল্যানের মেয়াদ শেষ — এখন শুধু ফ্রি প্ল্যানের ফিচার চালু আছে। সব তথ্য সংরক্ষিত আছে; নবায়ন করলে সব ফিরে আসবে।$/, (m, p) => `The ${p(m[1])} plan has ended — only free-plan features are on now. All data is kept; renew to get everything back.`],
];

/**
 * A stored notification text in the UI language. planNames: Bangla → English plan names (from the Plan table), so
 * "প্রিমিয়াম" shows as "Premium"; an unknown name stays as stored.
 */
export function localizeNotification(lang: "bn" | "en", text: string, planNames: Record<string, string> = {}): string {
  if (lang !== "en") return text;
  const plan = (bn: string) => planNames[bn] ?? bn;
  for (const [re, en] of RULES) {
    const m = text.match(re);
    if (m) return en(m, plan);
  }
  return text;
}
