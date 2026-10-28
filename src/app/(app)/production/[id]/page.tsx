import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { businessModules } from "@/lib/business-types";
import { KG_PER_MON } from "@/lib/paddy";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { PageHeader, PrintHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { loadProduction } from "@/server/services/production";
import { bagUnits, lineBags, millOutputKind, toKg, type MillOutputKind } from "@/server/services/rice-mill";

export const metadata: Metadata = { title: "উৎপাদন ব্যাচ" };

const KIND_LABEL: Record<MillOutputKind, string> = { rice: "মূল চাল", bran: "কুঁড়া", broken: "খুদ", husk: "তুষ / ভূসি" };
const KIND_TONE: Record<MillOutputKind, string> = { rice: "bg-emerald-100 text-emerald-800", bran: "bg-amber-100 text-amber-800", broken: "bg-sky-100 text-sky-800", husk: "bg-slate-200 text-slate-700" };
const WEIGHT = /কেজি|kg|মণ|mon|টন|ton|গ্রাম|gram/i;

/**
 * One production / milling batch: number, date, recipe, who entered it; the raw material used (kg, মণ, bags), the
 * rice and by-products made with their yield, the process loss, and the costs — cards and tables on screen, a
 * production slip on paper ("প্রিন্ট চালান").
 */
export default async function ProductionBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("production:view");
  const [v, bagOf] = await Promise.all([loadProduction(ctx.business.id, id), bagUnits(ctx.business.id)]);
  if (!v) notFound();
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const mill = businessModules(ctx.business.businessTypes).has("RICE_MILL");
  const pct = (n: number) => `${toBnDigits(n.toFixed(2))}%`;

  const line = (i: (typeof v.items)[number]) => {
    const qty = round3(num(i.baseQuantity));
    const unit = i.product.unit.name;
    return { id: i.id, name: i.product.name, unit, qty, kg: WEIGHT.test(unit) ? round3(toKg(qty, unit)) : null, bags: lineBags(i, bagOf), cost: num(i.costAmount), costShare: num(i.costShare ?? 0), warehouse: i.warehouse?.name ?? null };
  };
  const inputs = v.items.filter((i) => i.direction < 0).map(line);
  const outputs = v.items.filter((i) => i.direction > 0).map(line);
  // loss: in kg when every line is a weight, else in the one shared unit, else not shown
  const allWeight = [...inputs, ...outputs].every((l) => l.kg !== null);
  const oneUnit = new Set([...inputs, ...outputs].map((l) => l.unit)).size === 1;
  const inQty = round3(inputs.reduce((s, l) => s + (allWeight ? l.kg! : l.qty), 0));
  const outQty = round3(outputs.reduce((s, l) => s + (allWeight ? l.kg! : l.qty), 0));
  const lossUnit = allWeight ? "কেজি" : oneUnit ? inputs[0]?.unit ?? "" : null;
  const loss = lossUnit !== null && inQty > 0 ? { qty: round3(inQty - outQty), percent: round2(((inQty - outQty) / inQty) * 100) } : null;
  const yieldOf = (l: ReturnType<typeof line>) => (lossUnit !== null && inQty > 0 ? round2(((allWeight ? l.kg! : l.qty) / inQty) * 100) : null);
  const inputCost = round2(inputs.reduce((s, l) => s + l.cost, 0));
  const extraCost = num(v.productionRun?.extraCost ?? 0);
  const outputCost = round2(outputs.reduce((s, l) => s + l.cost, 0));
  const qtyText = (l: { qty: number; unit: string; kg: number | null }) => `${formatQty(l.qty)} ${l.unit}`;
  const monText = (kg: number | null) => (kg === null ? "" : `${toBnDigits((kg / KG_PER_MON).toFixed(2))} ${t("মণ")}`);
  const bagText = (b: number | null) => (b === null ? "—" : `${toBnDigits(Number.isInteger(b) ? String(b) : b.toFixed(2))} ${t("বস্তা")}`);
  const cell = "border border-slate-300 px-2 py-1.5 align-top print:border-slate-400 print:px-1.5 print:py-1";
  const enteredBy = v.createdBy?.name?.trim() || "—";

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`${t("উৎপাদন ব্যাচ")}: ${v.voucherNo}`}
          description={v.productionRun?.recipe ? `${t("রেসিপি")}: ${v.productionRun.recipe.name}` : t("রেসিপি ছাড়া (হাতে লেখা)")}
          crumbs={[{ label: mill ? "মিলিং ও প্রসেসিং" : "উৎপাদন", href: "/production" }, { label: v.voucherNo }]}
          actions={
            <>
              <PrintButton label="প্রিন্ট চালান" />
              <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="btn-secondary">{t("হিসাবের এন্ট্রি")}</Link>
              {can(ctx, "production:manage") && <Link prefetch={false} href={`/production/${v.id}/edit`} className="btn-secondary">{t("সম্পাদনা")}</Link>}
            </>
          }
        />
      </div>

      <article className="panel print-area p-5 print:border-0 print:p-0" id="production-batch">
        <PrintHeader business={ctx.business} title={`${t("উৎপাদন স্লিপ")} — ${v.voucherNo}`} subtitle={formatDate(v.date)} />

        {/* ── the batch at a glance */}
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2" id="batch-cards">
          <Card label="ব্যাচ নং" value={<span className="font-mono">{v.voucherNo}</span>} hint={formatDate(v.date)} />
          <Card label={mill ? "ব্যবহৃত কাঁচা ধান" : "ব্যবহৃত কাঁচামাল"} value={allWeight ? `${formatQty(inQty)} ${t("কেজি")}` : inputs.map(qtyText).join(", ")} hint={allWeight ? [monText(inQty), inputs.every((l) => l.bags !== null) ? bagText(round2(inputs.reduce((s, l) => s + l.bags!, 0))) : null].filter(Boolean).join(" · ") : undefined} tone="amber" />
          <Card label={mill ? "চাল ও উপজাত উৎপাদন" : "মোট উৎপাদন"} value={lossUnit !== null ? `${formatQty(outQty)} ${t(lossUnit)}` : toBnDigits(outputs.length)} hint={lossUnit !== null && inQty > 0 ? `${t("ফলন")} ${pct((outQty / inQty) * 100)}` : undefined} tone="green" />
          <Card label="অপচয় / প্রসেস লস" value={loss ? `${formatQty(loss.qty)} ${t(lossUnit!)}` : "—"} hint={loss ? pct(loss.percent) : t("একক মেলে না")} tone="red" />
        </div>
        <dl className="mb-5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4 print:grid-cols-4 print:text-[11px]">
          <div><dt className="text-xs text-slate-500">{t("তারিখ")}</dt><dd>{formatDate(v.date)}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("রেসিপি")}</dt><dd>{v.productionRun?.recipe?.name ?? "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("এন্ট্রিদাতা")}</dt><dd className="font-medium text-emerald-700 print:text-black" data-keep-lang id="batch-entered-by">{enteredBy}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("রেফারেন্স")}</dt><dd data-keep-lang>{v.reference || "—"}</dd></div>
          {v.narration && <div className="sm:col-span-4 print:col-span-4"><dt className="text-xs text-slate-500">{t("বিবরণ")}</dt><dd data-keep-lang>{v.narration}</dd></div>}
        </dl>

        {/* ── raw material */}
        <h2 className="mb-1.5 text-sm font-bold text-ink-900">{t(mill ? "ব্যবহৃত কাঁচা ধান" : "ব্যবহৃত কাঁচামাল")}</h2>
        <div className="mb-5 overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-sm print:text-[10.5px]" id="batch-inputs">
            <thead className="bg-slate-50 text-xs print:bg-white">
              <tr>
                <th className={`${cell} w-10 text-center`}>{t("নং")}</th>
                <th className={`${cell} text-left`}>{t(mill ? "ধানের জাত" : "কাঁচামাল")}</th>
                <th className={`${cell} text-right`}>{t("বস্তা")}</th>
                <th className={`${cell} text-right`}>{t("পরিমাণ")}</th>
                <th className={`${cell} text-right`}>{t("মণ")}</th>
                <th className={`${cell} text-right`}>{t("খরচ (গড় দরে)")}</th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((l, i) => (
                <tr key={l.id}>
                  <td className={`${cell} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                  <td className={cell}>{l.name}{l.warehouse && <span className="block text-xs text-slate-500 print:text-[9px]">{l.warehouse}</span>}</td>
                  <td className={`${cell} text-right tabular-nums`}>{bagText(l.bags)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{qtyText(l)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{monText(l.kg) || "—"}</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatMoney(l.cost, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── output */}
        <h2 className="mb-1.5 text-sm font-bold text-ink-900">{t(mill ? "চাল ও উপজাত উৎপাদন" : "উৎপাদিত পণ্য")}</h2>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-sm print:text-[10.5px]" id="batch-outputs">
            <thead className="bg-slate-50 text-xs print:bg-white">
              <tr>
                <th className={`${cell} w-10 text-center`}>{t("নং")}</th>
                <th className={`${cell} text-left`}>{t("পণ্য")}</th>
                <th className={`${cell} text-right`}>{t("বস্তা")}</th>
                <th className={`${cell} text-right`}>{t("পরিমাণ")}</th>
                <th className={`${cell} text-right`}>{t("ফলন")}</th>
                <th className={`${cell} text-right`}>{t("খরচের ভাগ")}</th>
                <th className={`${cell} text-right`}>{t("উৎপাদন খরচ")}</th>
              </tr>
            </thead>
            <tbody>
              {outputs.map((l, i) => {
                const kind = millOutputKind(l.name);
                const y = yieldOf(l);
                return (
                  <tr key={l.id}>
                    <td className={`${cell} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
                    <td className={cell}>
                      {l.name}
                      {mill && !l.name.includes(t(KIND_LABEL[kind])) && !KIND_LABEL[kind].split(" / ").some((w) => l.name.includes(w)) && <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold print:border print:border-slate-400 print:bg-transparent print:text-black ${KIND_TONE[kind]}`}>{t(KIND_LABEL[kind])}</span>}
                    </td>
                    <td className={`${cell} text-right tabular-nums`}>{bagText(l.bags)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{qtyText(l)}{l.kg !== null && <span className="block text-xs text-slate-500 print:text-[9px]">{monText(l.kg)}</span>}</td>
                    <td className={`${cell} text-right font-semibold tabular-nums`}>{y === null ? "—" : pct(y)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{pct(l.costShare)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{formatMoney(l.cost, cur)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-semibold">
              <tr>
                <td colSpan={3} className={`${cell} text-right`}>{t("মোট উৎপাদন")}</td>
                <td className={`${cell} text-right tabular-nums`}>{lossUnit !== null ? `${formatQty(outQty)} ${t(lossUnit)}` : "—"}</td>
                <td className={`${cell} text-right tabular-nums`}>{lossUnit !== null && inQty > 0 ? pct((outQty / inQty) * 100) : "—"}</td>
                <td className={cell} />
                <td className={`${cell} text-right tabular-nums`}>{formatMoney(outputCost, cur)}</td>
              </tr>
              <tr id="batch-loss">
                <td colSpan={3} className={`${cell} text-right`}>{t("অপচয় / প্রসেস লস (ধুলা, আর্দ্রতা)")}</td>
                <td className={`${cell} text-right tabular-nums`}>{loss ? `${formatQty(loss.qty)} ${t(lossUnit!)}` : "—"}</td>
                <td className={`${cell} text-right tabular-nums`}>{loss ? pct(loss.percent) : "—"}</td>
                <td colSpan={2} className={cell} />
              </tr>
            </tfoot>
          </table>
        </div>

        <dl className="mt-4 grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3 print:grid-cols-3 print:bg-white print:text-[11px]">
          <div><dt className="text-xs text-slate-500">{t("কাঁচামালের খরচ")}</dt><dd className="font-semibold tabular-nums">{formatMoney(inputCost, cur)}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("অতিরিক্ত খরচ (মজুরি, বিদ্যুৎ …)")}</dt><dd className="font-semibold tabular-nums">{formatMoney(extraCost, cur)}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("উৎপাদিত পণ্যের মোট খরচ")}</dt><dd className="font-semibold tabular-nums">{formatMoney(outputCost, cur)}</dd></div>
        </dl>

        <div className="print-only mt-14">
          <div className="grid grid-cols-3 gap-8 text-center text-xs">
            {["অপারেটর", "মিল ম্যানেজার", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-ink-800 pt-1">{t(s)}</p>)}
          </div>
        </div>
      </article>
    </>
  );
}

async function Card({ label, value, hint, tone = "slate" }: { label: string; value: React.ReactNode; hint?: string; tone?: "slate" | "amber" | "green" | "red" }) {
  const t = await getT();
  const bar = { slate: "border-l-slate-400", amber: "border-l-amber-500", green: "border-l-emerald-500", red: "border-l-red-500" }[tone];
  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 ${bar} bg-white px-3 py-2.5 print:border-slate-400`}>
      <p className="text-xs text-slate-500">{t(label)}</p>
      <p className="text-lg font-bold text-ink-900 tabular-nums print:text-sm">{value}</p>
      {hint && <p className="text-xs text-slate-500 print:text-[9px]">{hint}</p>}
    </div>
  );
}
