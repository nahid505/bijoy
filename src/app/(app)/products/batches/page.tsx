import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import type { ExpiryFilter } from "@/lib/expiry";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { ActionForm, ConfirmSubmitButton } from "@/components/forms";
import { ExpiryBadge } from "@/components/expiry-badge";
import { SearchSelectField } from "@/components/search-select";
import { EmptyState, FilterBar, FilterField, PageHeader, SortHeader, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { writeOffExpiredAction } from "@/server/actions/expiry";
import { listBatches, type BatchSort } from "@/server/services/expiry";
import { businessToday } from "@/server/services/notifications";
import { searchProducts } from "@/server/lookup";

export const metadata: Metadata = { title: "ব্যাচ ও মেয়াদ" };

const FILTERS: { key: ExpiryFilter; label: string }[] = [
  { key: "all", label: "সব" },
  { key: "valid", label: "🟢 বৈধ" },
  { key: "soon", label: "🟠 শীঘ্রই মেয়াদ শেষ" },
  { key: "expired", label: "🔴 মেয়াদোত্তীর্ণ" },
];

export default async function BatchesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("inventory:view");
  const p = await readParams(searchParams);
  const cur = ctx.business.currencySymbol;
  const filter = (FILTERS.some((f) => f.key === p.status) ? p.status : "all") as ExpiryFilter;
  const within = p.within && /^\d{1,4}$/.test(p.within) ? Number(p.within) : null;
  const sort = (["expiry", "product", "quantity", "batch"].includes(p.sort ?? "") ? p.sort : "expiry") as BatchSort;
  const today = businessToday();
  const [rows, batchProducts, picked] = await Promise.all([
    listBatches(ctx.business.id, today, { filter, within, q: p.q, productId: p.product, includeEmpty: p.empty === "1", sort, dir: p.dir === "desc" ? "desc" : "asc" }),
    prisma.product.count({ where: { businessId: ctx.business.id, trackBatch: true } }),
    p.product ? searchProducts(ctx.business.id, "", { ids: [p.product] }) : Promise.resolve([]),
  ]);
  const canWriteOff = can(ctx, "stock:adjust");
  const expiredRows = rows.filter((r) => r.status.code === "EXPIRED" && r.quantity > 0);
  const totalQty = round3(rows.reduce((s, r) => s + r.quantity, 0));
  const totalValue = round2(rows.reduce((s, r) => s + r.value, 0));
  const params = { ...p, page: undefined };
  const tab = (f: ExpiryFilter) => `/products/batches?status=${f}${p.product ? `&product=${p.product}` : ""}`;
  const heading = within !== null ? `${toBnDigits(within)} দিনের মধ্যে মেয়াদ শেষ হবে এমন ব্যাচ` : undefined;

  const table = (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            {canWriteOff && expiredRows.length > 0 && <th className="w-8"><span className="sr-only">নির্বাচন</span></th>}
            <SortHeader basePath="/products/batches" params={params} field="product" label="পণ্য" />
            <SortHeader basePath="/products/batches" params={params} field="batch" label="ব্যাচ / লট" />
            <th>উৎপাদন</th>
            <SortHeader basePath="/products/batches" params={params} field="expiry" label="মেয়াদ শেষ" />
            <th>অবস্থা</th>
            <SortHeader basePath="/products/batches" params={params} field="quantity" label="মজুদ" className="num" />
            <th className="num">ক্রয়মূল্য</th>
            <th className="num">মজুদ মূল্য</th>
            <th>সরবরাহকারী</th>
            <th className="no-print" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status.code === "EXPIRED" ? "bg-red-50/60" : r.status.code === "TODAY" || r.status.code === "SOON" ? "bg-amber-50/40" : ""}>
              {canWriteOff && expiredRows.length > 0 && (
                <td>{r.status.code === "EXPIRED" && r.quantity > 0 && <input type="checkbox" name="batchId" value={r.id} defaultChecked aria-label={`${r.productName} ${r.batchNo} বাতিলের জন্য নির্বাচন`} />}</td>
              )}
              <td>
                <Link prefetch={false} href={`/products/${r.productId}`} className="font-medium hover:text-brand-700 hover:underline">{r.productName}</Link>
                {r.productCode && <span className="block text-xs text-slate-400">{r.productCode}</span>}
              </td>
              <td className="font-mono text-xs">{r.batchNo}</td>
              <td className="text-xs">{r.mfgDate ? formatDate(r.mfgDate) : "—"}</td>
              <td className="whitespace-nowrap">{r.expiryDate ? formatDate(r.expiryDate) : "—"}</td>
              <td><ExpiryBadge status={r.status} /></td>
              <td className="num font-semibold">{formatQty(r.quantity)} {r.unit}</td>
              <td className="num">{formatMoney(r.costPrice, cur)}</td>
              <td className="num">{formatMoney(r.value, cur)}</td>
              <td className="text-xs">{r.supplierName ?? "—"}{r.purchaseDate && <span className="block text-slate-400">{formatDate(r.purchaseDate)}</span>}</td>
              <td className="no-print text-right">
                {can(ctx, "inventory:manage") && <Link prefetch={false} href={`/products/batches/${r.id}`} className="btn-ghost btn-sm">সংশোধন</Link>}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={canWriteOff && expiredRows.length > 0 ? 6 : 5}>মোট {toBnDigits(rows.length)} টি ব্যাচ</td>
              <td className="num">{formatQty(totalQty)}</td>
              <td />
              <td className="num">{formatMoney(totalValue, cur)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </TableWrap>
  );

  return (
    <>
      <PageHeader
        title="ব্যাচ ও মেয়াদ"
        description={heading ?? "ব্যাচভিত্তিক মজুদ, উৎপাদন ও মেয়াদের তারিখ — FEFO (আগে মেয়াদ শেষ, আগে বিক্রি)"}
        crumbs={[{ label: "পণ্য", href: "/products" }, { label: "ব্যাচ ও মেয়াদ" }]}
        actions={<Link prefetch={false} href="/reports/expiry-value" className="btn-secondary">মেয়াদ রিপোর্ট</Link>}
      />
      <section className="panel">
        <nav className="no-print flex flex-wrap gap-1 border-b border-rule px-3 pt-3" aria-label="মেয়াদ অবস্থা">
          {FILTERS.map((f) => (
            <Link
              prefetch={false}
              key={f.key}
              href={tab(f.key)}
              className={`rounded-t-md px-3 py-2 text-sm ${filter === f.key && within === null ? "border border-b-white border-rule bg-white font-semibold text-ink-900" : "text-slate-500 hover:text-ink-900"}`}
              aria-current={filter === f.key && within === null ? "page" : undefined}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <FilterBar action="/products/batches">
          <input type="hidden" name="status" value={filter} />
          <FilterField label="খুঁজুন">
            <input name="q" defaultValue={p.q ?? ""} placeholder="পণ্য, কোড বা ব্যাচ নং" className="input w-56" />
          </FilterField>
          <FilterField label="পণ্য">
            <SearchSelectField kind="products" name="product" id="filter-product" batchOnly initial={picked[0] ?? null} noneLabel="সব পণ্য" currency={cur} className="w-56" />
          </FilterField>
          <FilterField label="যত দিনের মধ্যে মেয়াদ শেষ">
            <select name="within" defaultValue={within !== null ? String(within) : ""} className="input w-36">
              <option value="">—</option>
              {[7, 15, 30, 60, 90].map((d) => <option key={d} value={d}>{toBnDigits(d)} দিন</option>)}
            </select>
          </FilterField>
          <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" name="empty" value="1" defaultChecked={p.empty === "1"} /> শূন্য মজুদের ব্যাচও</label>
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState message={batchProducts === 0 ? "কোনো ব্যাচভিত্তিক পণ্য নেই — পণ্যের সেটিংয়ে “ব্যাচ / মেয়াদ ট্র্যাক করুন” চালু করুন" : "এই ফিল্টারে কোনো ব্যাচ নেই"} />
        ) : canWriteOff && expiredRows.length > 0 ? (
          <ActionForm action={writeOffExpiredAction} className="space-y-0">
            <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-red-50 px-4 py-2 text-sm text-red-800">
              <span>🔴 {toBnDigits(expiredRows.length)} টি মেয়াদোত্তীর্ণ ব্যাচ — মোট মূল্য {formatMoney(round2(expiredRows.reduce((s, r) => s + r.value, 0)), cur)}। মেয়াদোত্তীর্ণ পণ্য বিক্রি করা যায় না; বাতিল করলে মজুদ কমে যাবে এবং ক্ষতি খরচ হিসেবে পোস্ট হবে।</span>
              <ConfirmSubmitButton
                label="নির্বাচিত ব্যাচ বাতিল (Write-off)"
                message="নির্বাচিত মেয়াদোত্তীর্ণ ব্যাচগুলোর সম্পূর্ণ মজুদ বাতিল হবে। একটি স্টক জার্নাল তৈরি হবে: ডেবিট “মেয়াদোত্তীর্ণ পণ্যের ক্ষতি”, ক্রেডিট “মজুদ পণ্য”। চালিয়ে যাবেন?"
                className="btn-danger btn-sm"
              />
            </div>
            {table}
          </ActionForm>
        ) : (
          table
        )}
      </section>
    </>
  );
}
