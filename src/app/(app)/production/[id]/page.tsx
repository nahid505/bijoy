import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { businessModules } from "@/lib/business-types";
import { KG_PER_MON } from "@/lib/paddy";
import { formatDate, formatMoney, formatNumber, formatQty, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { PageHeader, PrintHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { loadProduction } from "@/server/services/production";
import { bagUnits, lineBags, millOutputKind, millingProfitAnalysis, toKg, type MillOutputKind } from "@/server/services/rice-mill";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

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
  const ctx = await requirePermission(RICE_MILL_ACCESS.millingView);
  const [v, bagOf, profitAnalysis] = await Promise.all([
    loadProduction(ctx.business.id, id),
    bagUnits(ctx.business.id),
    millingProfitAnalysis(ctx.business.id, id),
  ]);
  if (!v) notFound();
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const mill = businessModules(ctx.business.businessTypes).has("RICE_MILL");
  const pct = (n: number) => `${formatNumber(n)}%`;
  const fmtKg = (val: number) => `${formatNumber(val)} ${t("কেজি")}`;

  const line = (i: (typeof v.items)[number]) => {
    const qty = round3(num(i.baseQuantity));
    const unit = i.product.unit.name;
    return { id: i.id, name: i.product.name, code: i.product.code ?? null, unit, qty, kg: WEIGHT.test(unit) ? round3(toKg(qty, unit)) : null, bags: lineBags(i, bagOf), cost: num(i.costAmount), costShare: num(i.costShare ?? 0), warehouse: i.warehouse?.name ?? null };
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
  const qtyText = (l: { qty: number; unit: string; kg: number | null }) => `${formatQty(l.qty)} ${l.unit}`;
  const monText = (kg: number | null) => (kg === null ? "" : `${toBnDigits((kg / KG_PER_MON).toFixed(2))} ${t("মণ")}`);
  const bagText = (b: number | null) => (b === null ? "—" : `${toBnDigits(Number.isInteger(b) ? String(b) : b.toFixed(2))} ${t("বস্তা")}`);
  const cell = "border border-slate-300 px-2 py-1.5 align-top print:border-slate-400 print:px-1.5 print:py-0.5 print:text-[10px]";
  const enteredBy = v.createdBy?.name?.trim() || "—";
  const inBags = round2(inputs.reduce((s, l) => s + (l.bags ?? 0), 0));
  const outBags = round2(outputs.reduce((s, l) => s + (l.bags ?? 0), 0));
  const totalRawCost = profitAnalysis ? profitAnalysis.totalRawFifoCost : inputs.reduce((s, l) => s + l.cost, 0);
  const totalPotentialRevenue = profitAnalysis?.totalPotentialRevenue ?? 0;
  const totalNetProfit = profitAnalysis ? profitAnalysis.totalNetProfit : 0;
  const overallMarginPct = profitAnalysis ? profitAnalysis.overallMarginPct : 0;
  const isProfit = totalNetProfit >= 0;

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
              {can(ctx, RICE_MILL_ACCESS.milling) && <Link prefetch={false} href={`/production/${v.id}/edit`} className="btn-secondary">{t("সম্পাদনা")}</Link>}
            </>
          }
        />
      </div>

      <article className="panel print-area p-5 print:border-0 print:p-0" id="production-batch">
        <PrintHeader business={ctx.business} title={`${t("উৎপাদন স্লিপ")} — ${v.voucherNo}`} subtitle={formatDate(v.date)} />

        {/* ── the batch at a glance */}
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden" id="batch-cards">
          <Card label="ব্যাচ নং" value={<span className="font-mono">{v.voucherNo}</span>} hint={formatDate(v.date)} />
          <Card label={mill ? "ব্যবহৃত কাঁচা ধান" : "ব্যবহৃত কাঁচামাল"} value={allWeight ? `${formatQty(inQty)} ${t("কেজি")}` : inputs.map(qtyText).join(", ")} hint={allWeight ? [monText(inQty), inputs.every((l) => l.bags !== null) ? bagText(round2(inputs.reduce((s, l) => s + l.bags!, 0))) : null].filter(Boolean).join(" · ") : undefined} tone="amber" />
          <Card label={mill ? "চাল ও উপজাত উৎপাদন" : "মোট উৎপাদন"} value={lossUnit !== null ? `${formatQty(outQty)} ${t(lossUnit)}` : toBnDigits(outputs.length)} hint={lossUnit !== null && inQty > 0 ? `${t("ফলন")} ${pct((outQty / inQty) * 100)}` : undefined} tone="green" />
          <Card label="অপচয় / প্রসেস লস" value={loss ? `${formatQty(loss.qty)} ${t(lossUnit!)}` : "—"} hint={loss ? pct(loss.percent) : t("একক মেলে না")} tone="red" />
        </div>
        <dl className="mb-5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4 print:hidden">
          <div><dt className="text-xs text-slate-500">{t("তারিখ")}</dt><dd>{formatDate(v.date)}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("রেসিপি")}</dt><dd>{v.productionRun?.recipe?.name ?? "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("এন্ট্রিদাতা")}</dt><dd className="font-medium text-emerald-700 print:text-black" data-keep-lang id="batch-entered-by">{enteredBy}</dd></div>
          <div><dt className="text-xs text-slate-500">{t("রেফারেন্স")}</dt><dd data-keep-lang>{v.reference || "—"}</dd></div>
          {v.narration && <div className="sm:col-span-4 print:col-span-4"><dt className="text-xs text-slate-500">{t("বিবরণ")}</dt><dd data-keep-lang>{v.narration}</dd></div>}
        </dl>

        {/* ── 1. Raw Material Consumption Table */}
        <section className="mb-6 print:mb-3 print:break-inside-avoid" id="batch-inputs-section">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-ink-900 flex items-center gap-1.5 print:text-xs">
              <span>🌾</span>
              <span>{t("ব্যবহৃত কাঁচামাল (ক্রয় হিসাব - FIFO)")}</span>
            </h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 print:border print:border-slate-300 print:bg-white print:text-[9px]">
              {t("প্রকৃত FIFO কস্টিং")}
            </span>
          </div>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-sm print:text-[10px]" id="batch-inputs">
              <thead className="bg-slate-50 text-xs print:bg-white">
                <tr>
                  <th className={`${cell} text-left`}>{t("কাঁচামাল")}</th>
                  <th className={`${cell} text-right`}>{t("মোট পরিমাণ (কেজি)")}</th>
                  <th className={`${cell} text-right`}>{t("বস্তা সংখ্যা")}</th>
                  <th className={`${cell} text-right`}>{t("প্রতি বস্তা/মণ দর (টাকা)")}</th>
                  <th className={`${cell} text-right`}>{t("মোট কাঁচামাল ক্রয় টাকা")}</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map((l) => {
                  const raw = profitAnalysis?.rawInputs.find((r) => r.id === l.id);
                  const cost = raw ? raw.fifoCost : l.cost;
                  const rateMon = raw ? raw.ratePerMon : (l.kg && l.kg > 0 ? round2((l.cost / l.kg) * KG_PER_MON) : 0);
                  const rateBag = l.bags && l.bags > 0 ? round2(cost / l.bags) : null;
                  return (
                    <tr key={l.id}>
                      <td className={cell}>
                        <span className="font-semibold text-ink-900">{l.name}</span>
                        {l.warehouse && <span className="block text-xs text-slate-500 print:text-[9px]">{l.warehouse}</span>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>{fmtKg(l.kg ?? l.qty)}</td>
                      <td className={`${cell} text-right tabular-nums`}>{bagText(l.bags)}</td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <span className="font-medium">{formatMoney(rateMon, cur)} / {t("মণ")}</span>
                        {rateBag !== null && <span className="block text-xs text-slate-500 print:text-[9px]">({formatMoney(rateBag, cur)} / {t("বস্তা")})</span>}
                        {raw && raw.consumedLots.length > 0 && (
                          <span className="block text-[10px] text-slate-400 print:text-[8px]">
                            {toBnDigits(raw.consumedLots.length)} {t("টি ক্রয় লট")}
                          </span>
                        )}
                      </td>
                      <td className={`${cell} text-right font-semibold tabular-nums text-ink-900`}>
                        {formatMoney(cost, cur)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50/75 font-semibold print:bg-transparent">
                <tr>
                  <td className={cell}>{t("ব্যবহৃত মোট কাঁচামাল")}</td>
                  <td className={`${cell} text-right tabular-nums`}>{fmtKg(inQty)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{bagText(inBags)}</td>
                  <td className={`${cell} text-right tabular-nums text-slate-600`}>
                    {inQty > 0 ? `${formatMoney(round2((totalRawCost / inQty) * KG_PER_MON), cur)} / ${t("মণ")}` : "—"}
                    {inBags > 0 && <span className="block text-xs text-slate-500 font-normal print:text-[9px]">({formatMoney(round2(totalRawCost / inBags), cur)} / {t("বস্তা")})</span>}
                  </td>
                  <td className={`${cell} text-right tabular-nums font-bold text-ink-900`}>
                    {formatMoney(totalRawCost, cur)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* ── 2. Unified Finished Goods & Yield Table */}
        <section className="mb-6 print:mb-3 print:break-inside-avoid" id="batch-outputs-section">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-ink-900 flex items-center gap-1.5 print:text-xs">
              <span>🌾</span>
              <span>{t("উৎপাদিত পণ্য ও ফলন হিসাব (বিক্রয় ও ফলন)")}</span>
            </h2>
          </div>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-sm print:text-[10px]" id="batch-outputs">
              <thead className="bg-slate-50 text-xs print:bg-white">
                <tr>
                  <th className={`${cell} w-12 text-center`}>{t("ক্রমিক")}</th>
                  <th className={`${cell} text-left`}>{t("উৎপাদিত পণ্য")}</th>
                  <th className={`${cell} text-right`}>{t("মোট পরিমাণ (কেজি ও বস্তা)")}</th>
                  <th className={`${cell} text-right`}>{t("৭৫ কেজিতে ফলন (কেজি)")}</th>
                  <th className={`${cell} text-right`}>{t("৮০ কেজিতে ফলন (কেজি)")}</th>
                  <th className={`${cell} text-right`}>{t("প্রতি বস্তা / কেজি দর (টাকা)")}</th>
                  <th className={`${cell} text-right`}>{t("মোট বিক্রি মূল্য (টাকা)")}</th>
                </tr>
              </thead>
              <tbody>
                {outputs.map((l, i) => {
                  const kind = millOutputKind(l.name);
                  const outKg = round3(allWeight ? (l.kg ?? l.qty) : l.qty);
                  const yield75 = inQty > 0 ? (outKg / inQty) * 75 : 0;
                  const yield80 = inQty > 0 ? (outKg / inQty) * 80 : 0;
                  const profitItem = profitAnalysis?.items.find((it) => it.id === l.id);
                  const avgRate = profitItem ? profitItem.avgSellingRate : (num(l.cost) || 0);
                  const potentialRevenue = profitItem ? profitItem.potentialRevenue : round2(outKg * avgRate);
                  const rateBag = l.bags && l.bags > 0 ? round2(potentialRevenue / l.bags) : null;
                  const challansUsed = profitItem?.challansUsed ?? 0;

                  return (
                    <tr key={l.id}>
                      <td className={`${cell} text-center tabular-nums`}>
                        {toBnDigits(i + 1)}
                        {l.code && <span className="block font-mono text-[10px] text-slate-500 print:text-[8px]">{l.code}</span>}
                      </td>
                      <td className={cell}>
                        <div className="font-semibold text-ink-900">{l.name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 print:text-[9px]">
                          {mill && (
                            <span className={`rounded px-1.5 py-0.2 text-[9.5px] font-semibold ${KIND_TONE[kind]}`}>
                              {t(KIND_LABEL[kind])}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <span className="font-semibold">{fmtKg(outKg)}</span>
                        {l.bags !== null && (
                          <span className="block text-xs text-slate-500 print:text-[9px]">
                            {bagText(l.bags)}
                          </span>
                        )}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>{inQty > 0 ? fmtKg(yield75) : "—"}</td>
                      <td className={`${cell} text-right tabular-nums`}>{inQty > 0 ? fmtKg(yield80) : "—"}</td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <span className="font-medium">{formatMoney(avgRate, cur)} / {t("কেজি")}</span>
                        {rateBag !== null && (
                          <span className="block text-xs text-slate-500 print:text-[9px]">
                            ({formatMoney(rateBag, cur)} / {t("বস্তা")})
                          </span>
                        )}
                        <span className="block text-[10px] text-slate-400 print:text-[8px]">
                          {challansUsed > 0
                            ? `${toBnDigits(challansUsed)} ${t("টি চালানের গড়")}`
                            : t("বর্তমান দর")}
                        </span>
                      </td>
                      <td className={`${cell} text-right font-semibold tabular-nums text-ink-900`}>
                        {formatMoney(potentialRevenue, cur)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-50/75 font-semibold print:bg-transparent">
                <tr>
                  <td colSpan={2} className={`${cell} text-right font-bold`}>{t("সর্বমোট উৎপাদিত পণ্য")}</td>
                  <td className={`${cell} text-right tabular-nums font-bold`}>
                    {fmtKg(outQty)}
                    {outBags > 0 && <span className="block text-xs text-slate-500 font-normal print:text-[9px]">{bagText(outBags)}</span>}
                  </td>
                  <td className={`${cell} text-right tabular-nums font-bold`}>{inQty > 0 ? fmtKg((outQty / inQty) * 75) : "—"}</td>
                  <td className={`${cell} text-right tabular-nums font-bold`}>{inQty > 0 ? fmtKg((outQty / inQty) * 80) : "—"}</td>
                  <td className={`${cell} text-right tabular-nums text-slate-400`}>—</td>
                  <td className={`${cell} text-right tabular-nums font-bold text-ink-900`}>
                    {formatMoney(totalPotentialRevenue, cur)}
                  </td>
                </tr>
                {loss && (
                  <tr id="batch-loss" className="text-slate-600 font-medium">
                    <td colSpan={2} className={`${cell} text-right text-xs`}>{t("অপচয় / প্রসেস লস (ধুলা, আর্দ্রতা)")}</td>
                    <td className={`${cell} text-right tabular-nums text-xs`}>{fmtKg(loss.qty)} ({pct(loss.percent)})</td>
                    <td className={`${cell} text-right tabular-nums text-xs`}>{inQty > 0 ? fmtKg((loss.qty / inQty) * 75) : "—"}</td>
                    <td className={`${cell} text-right tabular-nums text-xs`}>{inQty > 0 ? fmtKg((loss.qty / inQty) * 80) : "—"}</td>
                    <td className={`${cell} text-right tabular-nums text-slate-400`}>—</td>
                    <td className={`${cell} text-right tabular-nums text-slate-400`}>—</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </section>

        {/* ── 3. Net Profit / Loss Summary Card */}
        {profitAnalysis && (
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-xs print:mb-3 print:break-inside-avoid print:border-slate-300 print:p-2.5 print:shadow-none" id="batch-profit-loss">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <h2 className="text-sm font-bold text-ink-900 flex items-center gap-1.5 print:text-xs">
                <span>💰</span>
                <span>{t("নিট লাভ-ক্ষতি সারসংক্ষেপ")}</span>
              </h2>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                isProfit
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300 print:border-emerald-500"
                  : "bg-rose-100 text-rose-800 border border-rose-300 print:border-rose-500"
              }`}>
                <span className={`h-2 w-2 rounded-full ${isProfit ? "bg-emerald-600" : "bg-rose-600"}`} />
                {isProfit ? t("সম্ভাব্য নিট লাভ") : t("সম্ভাব্য নিট ক্ষতি")}: {isProfit ? "+" : ""}{formatMoney(totalNetProfit, cur)} ({isProfit ? "+" : ""}{pct(overallMarginPct)})
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
              {/* Step 1: Finished Goods Revenue */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 shadow-2xs print:border-slate-300 print:p-2">
                <p className="text-xs font-semibold text-slate-500">{t("মোট উৎপাদিত পণ্যের সম্ভাব্য মূল্য (টাকা)")}</p>
                <p className="mt-1 text-xl font-extrabold text-ink-900 tabular-nums print:text-base">
                  {formatMoney(totalPotentialRevenue, cur)}
                </p>
                <p className="mt-1 text-xs text-slate-500 print:text-[9px]">
                  {t("৩ চালানের গড় বিক্রয় মূল্যের ভিত্তিতে")}
                </p>
              </div>

              {/* Step 2: Raw Material Cost */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 shadow-2xs print:border-slate-300 print:p-2">
                <p className="text-xs font-semibold text-slate-500">{t("(-) ব্যবহৃত কাঁচামালের মোট ক্রয়মূল্য (টাকা)")}</p>
                <p className="mt-1 text-xl font-extrabold text-rose-700 tabular-nums print:text-base">
                  - {formatMoney(totalRawCost, cur)}
                </p>
                <p className="mt-1 text-xs text-slate-500 print:text-[9px]">
                  {profitAnalysis.consumedLots.length > 0
                    ? `${toBnDigits(profitAnalysis.consumedLots.length)} ${t("টি ক্রয় লটের প্রকৃত খরচের যোগফল (FIFO)")}`
                    : t("FIFO লটের প্রকৃত মূল্যের ভিত্তিতে")}
                </p>
              </div>

              {/* Step 3: Net Profit / Loss */}
              <div className={`rounded-lg border p-3.5 shadow-2xs print:p-2 ${
                isProfit
                  ? "border-emerald-300 bg-emerald-50/80 text-emerald-950 print:border-emerald-500 print:bg-emerald-50"
                  : "border-rose-300 bg-rose-50/80 text-rose-950 print:border-rose-500 print:bg-rose-50"
              }`}>
                <p className="text-xs font-bold text-slate-700">{t("(=) প্রকৃত সম্ভাব্য লাভ / ক্ষতি (টাকা)")}</p>
                <p className={`mt-1 text-2xl font-black tabular-nums print:text-lg ${
                  isProfit ? "text-emerald-700" : "text-rose-700"
                }`}>
                  {isProfit ? "+" : ""}{formatMoney(totalNetProfit, cur)}
                </p>
                <div className="mt-1 flex items-center justify-between text-xs font-semibold">
                  <span className={isProfit ? "text-emerald-800" : "text-rose-800"}>
                    {isProfit ? t("সম্ভাব্য নিট লাভ") : t("সম্ভাব্য নিট ক্ষতি")}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                    isProfit ? "bg-emerald-200/80 text-emerald-900" : "bg-rose-200/80 text-rose-900"
                  }`}>
                    {t("মার্জিন")}: {isProfit ? "+" : ""}{pct(overallMarginPct)}
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="print-only mt-14 print:mt-6 print:break-inside-avoid">
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
