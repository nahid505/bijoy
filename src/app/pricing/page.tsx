import type { Metadata } from "next";
import { getCurrentUser } from "@/server/auth";
import { loadPlans } from "@/server/billing/plans";
import { PricingSection } from "@/components/pricing-section";
import { PublicFooter, PublicHeader } from "@/components/public-site";

export const metadata: Metadata = { title: "মূল্য ও প্ল্যান", description: "বিজয় লেনদেনের প্ল্যান ও মূল্য — ফ্রি থেকে প্রিমিয়াম" };
export const dynamic = "force-dynamic";

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const cycle = (await searchParams).cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const [user, { plans, features, settings }] = await Promise.all([getCurrentUser(), loadPlans({ publicOnly: true, activeOnly: true })]);
  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader loggedIn={!!user} />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <PricingSection plans={plans} features={features} cycle={cycle} trialDays={settings.trialDays} currency={settings.currency === "BDT" ? "৳" : settings.currency} loggedIn={!!user} basePath="/pricing" />
      </main>
      <PublicFooter />
    </div>
  );
}
