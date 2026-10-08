import Link from "next/link";
import { formatDate, toBnDigits } from "@/lib/format";

type Sub = { status: string; blocked: boolean; daysLeft: number | null; inGrace: boolean; accessUntil: Date | null } | null;

/** One line under the header about the subscription (trial, expiring, grace, expired, suspended). */
export function SubscriptionBanner({ sub, canBill }: { sub: Sub; canBill: boolean }) {
  if (!sub) return null;
  let tone = "";
  let text = "";
  if (sub.blocked) {
    tone = "bg-red-600 text-white";
    text = "এই ব্যবসার সাবস্ক্রিপশন স্থগিত — শুধু বিলিং পাতা খোলা আছে। সহায়তার জন্য বিজয় লেনদেনের সাথে যোগাযোগ করুন।";
  } else if (sub.status === "EXPIRED") {
    tone = "bg-red-50 text-red-800 ring-1 ring-red-200";
    text = "সাবস্ক্রিপশনের মেয়াদ শেষ — এখন শুধু ফ্রি প্ল্যানের ফিচার চালু। আপনার সব তথ্য সংরক্ষিত আছে; নবায়ন করলে সব ফিরে আসবে।";
  } else if (sub.inGrace) {
    tone = "bg-amber-50 text-amber-900 ring-1 ring-amber-200";
    text = `মেয়াদ শেষ হয়েছে — গ্রেস পিরিয়ড ${sub.accessUntil ? formatDate(sub.accessUntil) : ""} পর্যন্ত। এর মধ্যে নবায়ন না করলে অতিরিক্ত ফিচার বন্ধ হবে।`;
  } else if (sub.status === "TRIAL" && sub.daysLeft !== null) {
    tone = "bg-sky-50 text-sky-900 ring-1 ring-sky-200";
    text = `ফ্রি ট্রায়াল চলছে — আর ${toBnDigits(Math.max(0, sub.daysLeft))} দিন বাকি।`;
  } else if (sub.status === "EXPIRING" && sub.daysLeft !== null) {
    tone = "bg-amber-50 text-amber-900 ring-1 ring-amber-200";
    text = `সাবস্ক্রিপশনের মেয়াদ ${toBnDigits(Math.max(0, sub.daysLeft))} দিন পর শেষ হবে।`;
  } else {
    return null;
  }
  return (
    <div className={`no-print flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm sm:px-6 ${tone}`} role="status">
      <span>{text}</span>
      {canBill && (
        <Link prefetch={false} href="/billing" className={`shrink-0 rounded px-2.5 py-1 text-xs font-semibold ${sub.blocked ? "bg-white text-red-700" : "bg-brand-600 text-white hover:bg-brand-700"}`}>
          {sub.status === "TRIAL" ? "প্ল্যান বেছে নিন" : "নবায়ন / আপগ্রেড"}
        </Link>
      )}
    </div>
  );
}
