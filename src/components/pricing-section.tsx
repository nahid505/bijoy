// DB-driven plan cards + comparison table with a monthly/yearly switch (pricing and landing pages).
import Link from "next/link";
import { toBnDigits } from "@/lib/format";
import { FeatureComparison, PlanCards, type FeatureRow, type PlanCardData } from "./plan-cards";

export function PricingSection({ heading = "h1", plans, features, cycle, trialDays, currency, loggedIn, basePath }: {
  plans: PlanCardData[]; features: FeatureRow[];
  heading?: "h1" | "h2"; cycle: "MONTHLY" | "YEARLY"; trialDays: number; currency: string; loggedIn: boolean; basePath: string;
}) {
  const Heading = heading;
  const tab = (c: "MONTHLY" | "YEARLY", label: string) => (
    <Link prefetch={false} scroll={false} href={`${basePath}?cycle=${c}#pricing`} aria-current={cycle === c ? "page" : undefined}
      className={`rounded-md px-4 py-1.5 text-sm font-medium ${cycle === c ? "bg-white text-ink-900 shadow-sm" : "text-slate-600 hover:text-ink-900"}`}>{label}</Link>
  );
  return (
    <section id="pricing" className="scroll-mt-20">
      <div className="text-center">
        <Heading className="text-3xl font-bold text-ink-900">আপনার ব্যবসার মাপে প্ল্যান</Heading>
        <p className="mt-2 text-slate-600">{trialDays > 0 ? `যেকোনো প্ল্যান ${toBnDigits(trialDays)} দিন ফ্রি ব্যবহার করুন। ` : ""}যেকোনো সময় আপগ্রেড বা ডাউনগ্রেড — আপনার ডেটা সবসময় নিরাপদ।</p>
        <div className="mt-5 inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-label="বিলিং চক্র">{tab("MONTHLY", "মাসিক")}{tab("YEARLY", "বার্ষিক")}</div>
      </div>
      <div className="mt-8">
        <PlanCards plans={plans} features={features} cycle={cycle} currency={currency}
          cta={(p) => loggedIn
            ? <Link prefetch={false} href="/billing" className="btn-secondary w-full justify-center">সাবস্ক্রিপশন দেখুন</Link>
            : <Link prefetch={false} href={`/register?plan=${p.code}`} className={`${p.code === "BUSINESS" ? "btn-primary" : "btn-secondary"} w-full justify-center`}>{p.free ? "ফ্রি শুরু করুন" : trialDays > 0 ? "ফ্রি ট্রায়াল শুরু করুন" : "শুরু করুন"}</Link>} />
      </div>
      <div className="panel mt-10 p-4 sm:p-6">
        <h2 className="mb-3 text-lg font-bold text-ink-900">প্ল্যান তুলনা</h2>
        <FeatureComparison plans={plans} features={features} />
      </div>
    </section>
  );
}
