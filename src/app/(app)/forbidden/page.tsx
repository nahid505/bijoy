import Link from "next/link";
import { featureDef, isFeatureKey } from "@/lib/features";
import { can, requireContext } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";

export default async function ForbiddenPage({ searchParams }: { searchParams: SearchParams }) {
  const { feature } = await readParams(searchParams);
  const f = feature && isFeatureKey(feature) ? featureDef(feature) : null;
  const ctx = f ? await requireContext() : null;
  return (
    <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
      <p className="text-5xl">{f ? f.icon : "🔒"}</p>
      <h1 className="mt-4 text-xl font-bold text-slate-800">{f ? `"${f.nameBn}" ফিচারটি বন্ধ আছে` : "প্রবেশাধিকার নেই"}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {f
          ? "এই ফিচারটি আপনার বর্তমান প্ল্যানে নেই। সংরক্ষিত তথ্য মুছে যায়নি — প্ল্যান আপগ্রেড করলে আবার দেখা যাবে।"
          : "এই পৃষ্ঠা দেখার অনুমতি আপনার রোলে নেই। প্রয়োজনে অ্যাডমিনের সাথে যোগাযোগ করুন।"}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link prefetch={false} href="/dashboard" className="btn-primary">ড্যাশবোর্ডে ফিরুন</Link>
        {f && ctx && can(ctx, "billing:view") && <Link prefetch={false} href="/billing" className="btn-secondary">প্ল্যান ও সাবস্ক্রিপশন</Link>}
      </div>
    </div>
  );
}
