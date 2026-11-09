import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatMoney, formatNumber, toBnDigits } from "@/lib/format";
import { EmptyState, FilterBar, FilterField, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";
import { ensureDefaultPackagingBags, getPackagingBagSummary } from "@/server/services/packaging-bag";
import { BagInventoryActions } from "./bag-inventory-client";

export const metadata: Metadata = {
  title: "খালি চালের বস্তা ইনভেন্টরি ও কনজাম্পশন ট্র্যাকিং",
};

const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : undefined);

const BAG_TYPE_LABELS: Record<string, string> = {
  BAG_50KG: "৫০ কেজি বস্তা",
  BAG_25KG: "২৫ কেজি বস্তা",
  BAG_10KG: "১০ কেজি বস্তা",
  BAG_5KG: "৫ কেজি বস্তা",
  OTHER: "অন্যান্য",
};

export default async function BagInventoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requirePermission(RICE_MILL_ACCESS.stock);
  const p = await readParams(searchParams);

  // Auto-seed default bags if business has none
  await ensureDefaultPackagingBags(ctx.business.id);

  const [summary, warehouses] = await Promise.all([
    getPackagingBagSummary(ctx.business.id, {
      from: day(p.from),
      to: day(p.to),
      warehouseId: p.warehouseId || undefined,
    }),
    prisma.warehouse.findMany({
      where: { businessId: ctx.business.id },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
  ]);

  const bagItemOptions = summary.items.map((i) => ({
    id: i.id,
    name: i.name,
    capacityKg: i.capacityKg,
    stock: i.stock,
    unit: i.unit,
  }));

  const warehouseOptions = warehouses.map((w) => ({
    id: w.id,
    name: w.name,
  }));

  return (
    <>
      <PageHeader
        title="খালি চালের বস্তা ইনভেন্টরি ও কনজাম্পশন ট্র্যাকিং"
        description="চালের খালি বস্তা ক্রয়, মিলিংয়ে স্বয়ংক্রিয় ব্যবহার (কনজাম্পশন), নষ্ট/ছেঁড়া বস্তা ও বর্তমান মজুদ হিসাব"
        crumbs={[{ label: "অটো রাইস মিল", href: "/purchases/paddy" }, { label: "খালি চালের বস্তা ইনভেন্টরি" }]}
        actions={
          <BagInventoryActions
            bagItems={bagItemOptions}
            warehouses={warehouseOptions}
          />
        }
      />

      {/* ৪টি প্রধান পরিসংখ্যান কার্ড (StatCards) */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="মোট ক্রয়কৃত খালি বস্তা"
          value={`${toBnDigits(formatNumber(summary.totalPurchased))} টি`}
          hint="ক্রয় ভাউচার ও প্রারম্ভিক স্টক"
          tone="blue"
        />
        <StatCard
          label="চালে ব্যবহৃত মোট বস্তা"
          value={`${toBnDigits(formatNumber(summary.totalConsumed))} টি`}
          hint="মিলিং ও চাল প্যাকিংয়ে খরচ"
          tone="green"
        />
        <StatCard
          label="নষ্ট / ছেঁড়া বস্তা (Wastage)"
          value={`${toBnDigits(formatNumber(summary.totalWastage))} টি`}
          hint="ছেঁড়া বা ত্রুটিজনিত ক্ষতি"
          tone="amber"
        />
        <StatCard
          label="গুদামে অবশিষ্ট ব্যালেন্স"
          value={`${toBnDigits(formatNumber(summary.currentBalance))} টি`}
          hint={`মোট মজুদ মূল্য: ${toBnDigits(formatMoney(summary.totalStockValue))}`}
          tone="blue"
        />
      </div>

      <section className="panel mb-6">
        <FilterBar action="/auto-rice-mill/bag-inventory">
          <FilterField label="তারিখ থেকে">
            <input type="date" name="from" defaultValue={p.from ?? ""} className="input w-40" />
          </FilterField>
          <FilterField label="পর্যন্ত">
            <input type="date" name="to" defaultValue={p.to ?? ""} className="input w-40" />
          </FilterField>
          <FilterField label="গুদাম">
            <select name="warehouseId" defaultValue={p.warehouseId ?? ""} className="input w-44">
              <option value="">— সকল গুদাম —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </FilterField>
        </FilterBar>

        <div className="border-b px-4 py-3">
          <h2 className="text-base font-bold text-slate-800">
            📦 খালি চালের বস্তা মজুদ ও ব্যবহার তালিকা (Inventory Breakdown)
          </h2>
          <p className="text-xs text-slate-500">
            প্রতিটি বস্তা সাইজের মোট ক্রয়, চাল উৎপাদনের বিপরীতে স্বয়ংক্রিয় কনজাম্পশন, নষ্ট বস্তা ও বর্তমান মজুদ
          </p>
        </div>

        {summary.items.length === 0 ? (
          <EmptyState message="কোনো খালি বস্তার আইটেম পাওয়া যায়নি" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>বস্তার বিবরণ / নাম</th>
                  <th>টাইপ ও ধারণক্ষমতা</th>
                  <th>উপাদান ও ব্র্যান্ড</th>
                  <th className="text-right">মোট ক্রয় (পিস)</th>
                  <th className="text-right">চালে ব্যবহৃত (পিস)</th>
                  <th className="text-right">নষ্ট / ড্যামেজ (পিস)</th>
                  <th className="text-right font-bold text-slate-800">বর্তমান মজুদ</th>
                  <th className="text-right">গড় ক্রয়মূল্য</th>
                  <th className="text-right">মোট মজুদ মূল্য</th>
                  <th className="text-center">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {summary.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <span className="font-semibold text-slate-900">{it.name}</span>
                      {it.code && <span className="block text-xs text-slate-400">কোড: {it.code}</span>}
                    </td>
                    <td>
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                        {BAG_TYPE_LABELS[it.bagType] ?? it.bagType}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {toBnDigits(it.capacityKg)} কেজি ধারণক্ষমতা
                      </span>
                    </td>
                    <td>
                      <span className="text-sm text-slate-700">{it.material || "—"}</span>
                      {it.brandName && (
                        <span className="block text-xs text-slate-500">ব্র্যান্ড: {it.brandName}</span>
                      )}
                    </td>
                    <td className="text-right font-medium text-blue-700">
                      {toBnDigits(formatNumber(it.totalPurchased))}
                    </td>
                    <td className="text-right font-medium text-green-700">
                      {toBnDigits(formatNumber(it.totalConsumed))}
                    </td>
                    <td className="text-right font-medium text-amber-700">
                      {toBnDigits(formatNumber(it.totalWasted))}
                    </td>
                    <td className="text-right font-bold text-slate-900 bg-slate-50/50">
                      {toBnDigits(formatNumber(it.stock))} {it.unit}
                    </td>
                    <td className="text-right text-slate-600">
                      {toBnDigits(formatMoney(it.avgCost))}
                    </td>
                    <td className="text-right font-semibold text-slate-800">
                      {toBnDigits(formatMoney(it.totalValue))}
                    </td>
                    <td className="text-center">
                      <Link
                        prefetch={false}
                        href={`/products?q=${encodeURIComponent(it.name)}`}
                        className="text-xs text-brand-700 hover:underline font-medium"
                      >
                        লেজার / বিবরণ
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold text-slate-800">
                  <td colSpan={3}>সর্বমোট</td>
                  <td className="text-right text-blue-700">
                    {toBnDigits(formatNumber(summary.totalPurchased))}
                  </td>
                  <td className="text-right text-green-700">
                    {toBnDigits(formatNumber(summary.totalConsumed))}
                  </td>
                  <td className="text-right text-amber-700">
                    {toBnDigits(formatNumber(summary.totalWastage))}
                  </td>
                  <td className="text-right text-slate-900">
                    {toBnDigits(formatNumber(summary.currentBalance))} টি
                  </td>
                  <td></td>
                  <td className="text-right text-brand-800">
                    {toBnDigits(formatMoney(summary.totalStockValue))}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </section>

      {/* সাম্প্রতিক নষ্ট / ছেঁড়া বস্তা ট্র্যাকিং ইতিহাস */}
      <section className="panel">
        <div className="border-b px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              ⚠️ সাম্প্রতিক নষ্ট / ছেঁড়া বস্তার রেকর্ড (Damage / Wastage Log)
            </h2>
            <p className="text-xs text-slate-500">
              গুদামে নষ্ট বা বাতিল হওয়া বস্তার পরিমাণ ও আর্থিক ক্ষতির বিবরণী
            </p>
          </div>
        </div>

        {summary.recentWastages.length === 0 ? (
          <EmptyState message="এখনও কোনো নষ্ট বস্তার এন্ট্রি রেকর্ড নেই" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>তারিখ</th>
                  <th>বস্তার বিবরণ</th>
                  <th>গুদাম</th>
                  <th className="text-right">নষ্টের সংখ্যা (পিস)</th>
                  <th className="text-right">একক দর</th>
                  <th className="text-right">মোট ক্ষতিমূল্য</th>
                  <th>কারণ</th>
                  <th>মন্তব্য</th>
                  <th>এন্ট্রি করেছেন</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentWastages.map((w) => (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap font-medium text-slate-800">
                      {formatDate(w.date)}
                    </td>
                    <td className="font-semibold text-slate-900">{w.bagName}</td>
                    <td>{w.warehouseName}</td>
                    <td className="text-right font-bold text-amber-700">
                      {toBnDigits(formatNumber(w.quantity))} টি
                    </td>
                    <td className="text-right text-slate-600">
                      {toBnDigits(formatMoney(w.costRate))}
                    </td>
                    <td className="text-right font-semibold text-red-600">
                      {toBnDigits(formatMoney(w.costAmount))}
                    </td>
                    <td>
                      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
                        {w.reason || "—"}
                      </span>
                    </td>
                    <td className="text-sm text-slate-500">{w.notes || "—"}</td>
                    <td className="text-xs text-slate-500">{w.createdByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
