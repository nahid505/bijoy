// Small server-rendered pieces shared by the depot pages.
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { DEPOT_MODE_SHORT, type DepotMode } from "@/lib/depot";

/** Shown when a non-depot business opens a depot page. */
export function DepotOnlyNotice({ canManage }: { canManage: boolean }) {
  return (
    <>
      <PageHeader title="ডিপো ব্যবস্থাপনা" description="এই অংশ শুধু ডিপো ব্যবসার জন্য" />
      <section className="panel max-w-2xl space-y-3 p-6">
        <p className="text-slate-700">আপনার ব্যবসার ধরন এখন &ldquo;ডিপো ব্যবসা&rdquo; নয়। ডিপো ড্যাশবোর্ড, ডেলিভারি চালান (ডিও রিলিজ / মার্কেট সেলস), কোম্পানি কমিশন ও রুটভিত্তিক মার্কেট বাকি পেতে ব্যবসার ধরন পরিবর্তন করুন।</p>
        {canManage ? <Link prefetch={false} href="/business" className="btn-primary inline-flex">ব্যবসা সেটিং খুলুন</Link> : <p className="text-sm text-slate-500">ব্যবসা সেটিং পরিবর্তনের অনুমতি মালিক/অ্যাডমিনের আছে।</p>}
      </section>
    </>
  );
}

export function ModeBadge({ mode }: { mode: DepotMode }) {
  return <Badge tone={mode === "COMPANY_PAID" ? "blue" : "amber"}>{DEPOT_MODE_SHORT[mode]}</Badge>;
}
