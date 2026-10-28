// Small UI pieces shared by the depot pages (server components — PageHeader / Badge come from the server-side ui.tsx).
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { DEPOT_MODE_SHORT, type DepotMode } from "@/lib/depot";
import { getT } from "@/server/i18n";

/** Shown when a non-depot business opens a depot page. */
export async function DepotOnlyNotice({ canManage }: { canManage: boolean }) {
  const t = await getT();
  return (
    <>
      <PageHeader title="ডিপো ব্যবস্থাপনা" description="এই অংশ শুধু ডিপো ব্যবসার জন্য" />
      <section className="panel max-w-2xl space-y-3 p-6">
        <p className="text-slate-700">{t("আপনার ব্যবসার ধরনে “ডিপো ব্যবসা” বাছাই করা নেই। ডিপো ড্যাশবোর্ড, ডেলিভারি চালান (ডিও রিলিজ / মার্কেট সেলস), কোম্পানি কমিশন ও রুটভিত্তিক মার্কেট বাকি পেতে ব্যবসা সেটিং → “ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা”-তে ডিপো ব্যবসা বাছাই করুন (মালিক)।")}</p>
        {canManage ? <Link prefetch={false} href="/business#business-types-section" className="btn-primary inline-flex">{t("ব্যবসা সেটিং খুলুন")}</Link> : <p className="text-sm text-slate-500">{t("ব্যবসা সেটিং পরিবর্তনের অনুমতি মালিক/অ্যাডমিনের আছে।")}</p>}
      </section>
    </>
  );
}

export async function ModeBadge({ mode }: { mode: DepotMode }) {
  const t = await getT();
  return <Badge tone={mode === "COMPANY_PAID" ? "blue" : "amber"}>{t(DEPOT_MODE_SHORT[mode])}</Badge>;
}
