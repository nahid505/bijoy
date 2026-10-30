import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { num } from "@/lib/db";
import { TRADE_TYPES, VOUCHER_TYPES } from "@/lib/accounting";
import { paymentStatus, PAYMENT_STATUS_LABELS, round2 } from "@/lib/calc";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { PaddySlip, toPaddySlipData } from "@/components/paddy-slip";
import { DepotChallan } from "@/components/depot-challan";
import { AmountInWords } from "@/components/amount-words";
import { PosPageSize } from "@/components/pos-page-size";
import { can, requireContext } from "@/server/auth";
import { batchesOfItem, loadVoucher } from "@/server/voucher-detail";
import { voucherAccess } from "@/server/voucher-permissions";
import { canSeeVoucher } from "@/server/party-scope";
import { readParams, type SearchParams } from "@/server/params";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "প্রিন্ট" };

/** Printable voucher / invoice / dealer challan (A4 or 80mm POS slip, "Save as PDF" from print dialog). */
export default async function VoucherPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParams;
}) {
  const { id } = await params;
  const p = searchParams ? await readParams(searchParams) : {};
  const pos = p.format === "pos";
  const ctx = await requireContext();
  const t = await getT();
  const v = await loadVoucher(ctx.business.id, id);
  if (!v) notFound();
  if (
    !can(ctx, voucherAccess(v.type, "view", ctx.business.businessType, v.book)) &&
    !(v.type === "OPENING" && can(ctx, "accounts:view"))
  )
    redirect("/forbidden");
  if (!(await canSeeVoucher(ctx, v.id))) redirect("/forbidden"); // assigned-only roles: another party's voucher

  const b = ctx.business;
  const cur = b.currencySymbol;
  const meta = VOUCHER_TYPES[v.type];
  const trade = TRADE_TYPES.includes(v.type);
  const party = v.partyAccount?.customer ?? v.partyAccount?.supplier;
  const amount = num(v.amount);
  const paid = num(v.paidAmount);
  const doRelease = v.type === "DEPOT_DELIVERY";

  const isDealerChallan =
    !v.depotDelivery &&
    !v.paddyPurchase &&
    (p.challan === "1" ||
      v.book === "DEPOT" ||
      !!v.partyAccount?.customer?.isDepotDealer ||
      v.items.some((i) => num(i.freeQuantity) > 0));

  const title = isDealerChallan
    ? "ডিলার চালান"
    : v.depotDelivery
    ? "ডেলিভারি চালান"
    : v.paddyPurchase
    ? "ধান ক্রয় চালান"
    : v.type === "SALES"
    ? "ইনভয়েস / বিল"
    : v.type === "RECEIPT"
    ? "মানি রিসিপ্ট"
    : meta.long;

  const dr = round2(v.entries.reduce((s, e) => s + num(e.debit), 0));

  const totalMainQty = v.items.reduce((s, i) => s + num(i.quantity), 0);
  const totalFreeQty = v.items.reduce((s, i) => s + num(i.freeQuantity), 0);
  const totalLineAmount = v.items.reduce(
    (s, i) => s + round2(num(i.quantity) * num(i.rate)),
    0
  );

  const toolbar = (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <PrintButton label={t("প্রিন্ট / PDF")} />
      {isDealerChallan && (
        <span
          className="inline-flex overflow-hidden rounded-md border border-rule text-sm"
          role="group"
          aria-label={t("প্রিন্ট ফরম্যাট")}
        >
          <Link
            prefetch={false}
            href={`/vouchers/v/${v.id}/print?challan=1`}
            aria-current={!pos ? "page" : undefined}
            className={`px-3 py-1.5 ${!pos ? "bg-brand-600 font-semibold text-white" : "bg-white hover:bg-brand-50"}`}
          >
            A4
          </Link>
          <Link
            prefetch={false}
            href={`/vouchers/v/${v.id}/print?challan=1&format=pos`}
            aria-current={pos ? "page" : undefined}
            className={`border-l border-rule px-3 py-1.5 ${pos ? "bg-brand-600 font-semibold text-white" : "bg-white hover:bg-brand-50"}`}
          >
            {t("POS স্লিপ (৮০ মিমি)")}
          </Link>
        </span>
      )}
      <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="btn-secondary">
        {t("← ভাউচারে ফিরুন")}
      </Link>
      {isDealerChallan && (
        <Link prefetch={false} href="/depot/deliveries/new" className="btn-secondary">
          {t("নতুন ডেলিভারি চালান")}
        </Link>
      )}
    </div>
  );

  // ── POS Slip format (80mm thermal roll) for Dealer Challan
  if (pos && isDealerChallan) {
    return (
      <>
        {toolbar}
        <PosPageSize targetId="dealer-challan-slip" />
        <article
          id="dealer-challan-slip"
          className="challan-slip print-area mx-auto w-[76mm] bg-white p-2 text-[11px] leading-snug text-black shadow print:w-full print:p-0 print:shadow-none"
        >
          <header className="border-b border-dashed border-black pb-1.5 text-center">
            <p className="text-sm font-bold">{b.name}</p>
            {b.address && <p className="text-[10px] text-slate-700">{b.address}</p>}
            {b.mobile && <p className="text-[10px] text-slate-700">{b.mobile}</p>}
            <p className="mt-1 text-xs font-bold uppercase">{t("ডিলার চালান")}</p>
          </header>

          <div className="border-b border-dashed border-black py-1 text-[10px]">
            <p>
              {t("চালান নং")}: <b>{v.voucherNo}</b>
            </p>
            <p>
              {t("তারিখ")}: {formatDate(v.date)}
            </p>
            {v.partyAccount && (
              <>
                <p>
                  {t("ডিলার")}: <b>{v.partyAccount.name}</b>
                </p>
                {party?.address && <p>{party.address}</p>}
                {party?.mobile && <p>{t("মোবাইল")}: {party.mobile}</p>}
              </>
            )}
          </div>

          <table className="my-1.5 w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-0.5">#</th>
                <th className="py-0.5">{t("পণ্য")}</th>
                <th className="py-0.5 text-center">{t("পরিমাণ")}</th>
                <th className="py-0.5 text-right">{t("দর")}</th>
                <th className="py-0.5 text-right">{t("মোট")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-black">
              {v.items.map((i, idx) => {
                const qty = num(i.quantity);
                const free = num(i.freeQuantity);
                const rate = num(i.rate);
                const lineTotal = round2(qty * rate);
                return (
                  <tr key={i.id}>
                    <td className="py-1 align-top">{toBnDigits(idx + 1)}</td>
                    <td className="py-1 align-top">
                      <p className="font-semibold">{i.product.name}</p>
                      {i.product.code && (
                        <p className="text-[9px] text-slate-700">[{i.product.code}]</p>
                      )}
                    </td>
                    <td className="py-1 text-center align-top tabular-nums">
                      {formatQty(qty)}
                      {free > 0 && (
                        <span className="block font-bold text-[9px] text-emerald-800">
                          + {t("ফ্রি")} {formatQty(free)}
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right align-top tabular-nums">
                      {formatMoney(rate, cur)}
                    </td>
                    <td className="py-1 text-right align-top tabular-nums font-semibold">
                      {formatMoney(lineTotal, cur)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="space-y-0.5 border-t border-dashed border-black pt-1 text-[10px]">
            <div className="flex justify-between">
              <span>{t("মোট মূল পরিমাণ")}:</span>
              <b>{formatQty(totalMainQty)}</b>
            </div>
            {totalFreeQty > 0 && (
              <div className="flex justify-between text-emerald-800 font-semibold">
                <span>{t("মোট ফ্রি পরিমাণ")}:</span>
                <span>{formatQty(totalFreeQty)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{t("উপমোট")}:</span>
              <span>{formatMoney(totalLineAmount, cur)}</span>
            </div>
            {num(v.discount) > 0 && (
              <div className="flex justify-between">
                <span>{t("ছাড়")}:</span>
                <span>− {formatMoney(num(v.discount), cur)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-black pt-0.5 font-bold text-xs">
              <span>{t("সর্বমোট")}:</span>
              <span>{formatMoney(amount, cur)}</span>
            </div>
            {paid > 0 && (
              <div className="flex justify-between">
                <span>{t("পরিশোধ")}:</span>
                <span>{formatMoney(paid, cur)}</span>
              </div>
            )}
            {amount - paid > 0 && (
              <div className="flex justify-between font-bold">
                <span>{t("বাকি")}:</span>
                <span>{formatMoney(amount - paid, cur)}</span>
              </div>
            )}
          </div>

          <div className="mt-8 flex justify-between text-center text-[9px]">
            <div className="w-24 border-t border-black pt-0.5">{t("গ্রহীতার স্বাক্ষর")}</div>
            <div className="w-24 border-t border-black pt-0.5">{t("ডিপো ইনচার্জের স্বাক্ষর")}</div>
          </div>
        </article>
      </>
    );
  }

  // ── Standard A4 View (with exact 7-column table for Dealer Challan)
  return (
    <>
      {toolbar}

      <article className="panel print-area mx-auto max-w-[210mm] bg-white p-8 text-sm">
        {/* Document Header */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div className="flex items-start gap-3">
            {b.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo} alt="" className="h-14 w-14 object-contain" />
            )}
            <div>
              <h1 className="text-xl font-bold text-ink-900">{b.name}</h1>
              {b.address && <p className="whitespace-pre-line text-xs text-slate-600">{b.address}</p>}
              <p className="text-xs text-slate-600">
                {[b.mobile, b.email].filter(Boolean).join(" · ")}
              </p>
              {(b.binNumber || b.tinNumber) && (
                <p className="text-xs text-slate-600">
                  {[b.binNumber && `BIN: ${b.binNumber}`, b.tinNumber && `TIN: ${b.tinNumber}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-ink-900">{t(title)}</p>
            <p className="mt-1">
              {t("নং:")} <b>{v.voucherNo}</b>
            </p>
            <p>
              {t("তারিখ:")} {formatDate(v.date)}
            </p>
            {v.reference && (
              <p>
                {t("রেফারেন্স:")} {v.reference}
              </p>
            )}
            {trade && !isDealerChallan && (
              <p className="mt-1 font-semibold">
                {t(PAYMENT_STATUS_LABELS[paymentStatus(amount, paid)])}
              </p>
            )}
          </div>
        </header>

        {/* Party / Dealer Details */}
        {v.partyAccount && (
          <section className="py-3 border-b border-slate-200">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  {t(
                    isDealerChallan
                      ? "ডিলার"
                      : doRelease
                      ? "কোম্পানি (ডিও)"
                      : v.depotDelivery
                      ? "ডিলার"
                      : v.type === "SALES" || v.type === "SALES_RETURN"
                      ? "কাস্টমার"
                      : v.type === "PURCHASE" || v.type === "PURCHASE_RETURN"
                      ? "সরবরাহকারী"
                      : "পার্টি/হিসাব"
                  )}
                </p>
                <p className="text-base font-bold text-slate-900">{v.partyAccount.name}</p>
                {party?.address && <p className="text-xs text-slate-600">{party.address}</p>}
                {party?.mobile && (
                  <p className="text-xs text-slate-600">
                    {t("মোবাইল")}: {party.mobile}
                  </p>
                )}
              </div>
              {v.partyAccount?.customer?.route && (
                <div className="text-right">
                  <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {t("রুট")}: {v.partyAccount.customer.route}
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {v.depotDelivery && (
          <DepotChallan
            currency={cur}
            d={{
              mode: v.depotDelivery.mode,
              doNumber: v.depotDelivery.doNumber,
              company: v.depotDelivery.companyAccount?.name ?? null,
              dealer: v.depotDelivery.dealerAccount?.name ?? null,
              route: v.depotDelivery.dealerAccount?.customer?.route ?? null,
              dealerMobile: v.depotDelivery.dealerAccount?.customer?.mobile ?? null,
              vehicleNo: v.depotDelivery.vehicleNo,
              driverName: v.depotDelivery.driverName,
              commission: num(v.depotDelivery.commissionTotal),
              notes: v.depotDelivery.notes,
            }}
          />
        )}
        {v.paddyPurchase && <PaddySlip currency={cur} d={toPaddySlipData(v.paddyPurchase)} />}

        {/* ── 7-Column Table for Dealer Challan */}
        {isDealerChallan && v.items.length > 0 ? (
          <div className="mt-4 overflow-x-auto print:overflow-visible">
            <table className="print-challan-table w-full border-collapse border border-black text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-slate-100 text-xs font-bold text-black print:bg-slate-200">
                  <th className="w-12 border border-black px-2.5 py-2 text-center">{t("নম্বর")}</th>
                  <th className="w-28 border border-black px-2.5 py-2 text-left">{t("কোড")}</th>
                  <th className="border border-black px-2.5 py-2 text-left">{t("পণ্যের নাম")}</th>
                  <th className="w-32 border border-black px-2.5 py-2 text-center">{t("মূল পরিমাণ")}</th>
                  <th className="w-28 border border-black px-2.5 py-2 text-center">{t("ফ্রি পরিমাণ")}</th>
                  <th className="w-28 border border-black px-2.5 py-2 text-right">{t("দর")}</th>
                  <th className="w-32 border border-black px-2.5 py-2 text-right">{t("মোট টাকা")}</th>
                </tr>
              </thead>
              <tbody>
                {v.items.map((i, idx) => {
                  const qty = num(i.quantity);
                  const free = num(i.freeQuantity);
                  const rate = num(i.rate);
                  const lineTotal = round2(qty * rate);
                  return (
                    <tr key={i.id} className="border-b border-black">
                      <td className="border border-black px-2.5 py-2 text-center font-medium tabular-nums">
                        {toBnDigits(idx + 1)}
                      </td>
                      <td className="border border-black px-2.5 py-2 text-xs font-mono font-bold text-slate-800 print:text-black">
                        {i.product.code || "—"}
                      </td>
                      <td className="border border-black px-2.5 py-2 font-medium">
                        {i.product.name}
                        {i.unit && (
                          <span className="text-xs text-slate-600 print:text-black">
                            {" "}
                            ({i.unit.name})
                          </span>
                        )}
                        {batchesOfItem(i, formatDate, formatQty) && (
                          <span className="block text-[11px] text-slate-600 print:text-black">
                            {t("ব্যাচ:")} {batchesOfItem(i, formatDate, formatQty)}
                          </span>
                        )}
                      </td>
                      <td className="border border-black px-2.5 py-2 text-center tabular-nums font-semibold">
                        {formatQty(qty)}
                      </td>
                      <td className="border border-black px-2.5 py-2 text-center tabular-nums font-semibold text-emerald-800 print:text-black">
                        {free > 0 ? formatQty(free) : "—"}
                      </td>
                      <td className="border border-black px-2.5 py-2 text-right tabular-nums">
                        {formatMoney(rate, cur)}
                      </td>
                      <td className="border border-black px-2.5 py-2 text-right tabular-nums font-bold">
                        {formatMoney(lineTotal, cur)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black bg-slate-100 font-bold text-black print:bg-slate-200">
                  <td colSpan={3} className="border border-black px-2.5 py-2 text-right">
                    {t("মোট")}
                  </td>
                  <td className="border border-black px-2.5 py-2 text-center tabular-nums font-bold">
                    {formatQty(totalMainQty)}
                  </td>
                  <td className="border border-black px-2.5 py-2 text-center tabular-nums font-bold text-emerald-800 print:text-black">
                    {totalFreeQty > 0 ? formatQty(totalFreeQty) : "—"}
                  </td>
                  <td className="border border-black px-2.5 py-2 text-right" />
                  <td className="border border-black px-2.5 py-2 text-right tabular-nums font-bold">
                    {formatMoney(totalLineAmount, cur)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : v.items.length > 0 ? (
          /* Standard generic voucher table */
          <div className="mt-2 overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y-2 border-ink-800 bg-ink-50 text-left text-xs">
                  <th className="px-2 py-1.5">{t("ক্রম")}</th>
                  <th className="px-2 py-1.5">{t("পণ্যের বিবরণ")}</th>
                  <th className="px-2 py-1.5 text-right">{t("পরিমাণ")}</th>
                  <th className="px-2 py-1.5 text-right">{t(doRelease ? "কমিশন হার" : "দর")}</th>
                  {trade && <th className="px-2 py-1.5 text-right">{t("ছাড়")}</th>}
                  <th className="px-2 py-1.5 text-right">{t(doRelease ? "কমিশন" : "টাকা")}</th>
                </tr>
              </thead>
              <tbody>
                {v.items.map((i, idx) => (
                  <tr key={i.id} className="border-b border-rule">
                    <td className="px-2 py-1.5">{toBnDigits(idx + 1)}</td>
                    <td className="px-2 py-1.5">
                      {i.product.name}
                      {v.type === "STOCK_JOURNAL" &&
                        ` (${i.direction === 1 ? t("আগমন") : t("বাহির")} — ${i.warehouse?.name})`}
                      {batchesOfItem(i, formatDate, formatQty) && (
                        <span className="block text-[11px] text-slate-500">
                          {t("ব্যাচ:")} {batchesOfItem(i, formatDate, formatQty)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatQty(num(i.quantity))} {i.unit?.name}
                      {num(i.freeQuantity) > 0 && (
                        <span className="block text-[11px] font-semibold text-amber-800">
                          + {t("ফ্রি")} {formatQty(num(i.freeQuantity))}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatMoney(num(i.rate), cur)}
                    </td>
                    {trade && (
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {num(i.discount) ? formatMoney(num(i.discount), cur) : ""}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatMoney(num(i.amount), cur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y-2 border-ink-800 bg-ink-50 text-left text-xs">
                  <th className="px-2 py-1.5">{t("হিসাব")}</th>
                  <th className="px-2 py-1.5">{t("বিবরণ")}</th>
                  <th className="px-2 py-1.5 text-right">{t("ডেবিট")}</th>
                  <th className="px-2 py-1.5 text-right">{t("ক্রেডিট")}</th>
                </tr>
              </thead>
              <tbody>
                {v.entries.map((e) => (
                  <tr key={e.id} className="border-b border-rule">
                    <td className="px-2 py-1.5">{e.account.name}</td>
                    <td className="px-2 py-1.5 text-slate-600">{e.narration}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {num(e.debit) ? formatMoney(num(e.debit), cur) : ""}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {num(e.credit) ? formatMoney(num(e.credit), cur) : ""}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-double border-ink-800 font-bold">
                  <td className="px-2 py-1.5" colSpan={2}>
                    {t("মোট")}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMoney(dr, cur)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMoney(dr, cur)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Financial Summary */}
        {trade && (
          <div className="mt-4 flex justify-end">
            <dl className="w-72 space-y-1">
              <Line label={t("উপমোট")} value={formatMoney(num(v.subtotal) || totalLineAmount, cur)} />
              {num(v.discount) > 0 && (
                <Line
                  label={t("ছাড়")}
                  value={`− ${formatMoney(num(v.discount), cur)}`}
                />
              )}
              {num(v.vatAmount) > 0 && (
                <Line
                  label={`${t("ভ্যাট")} (${formatQty(num(v.vatPercent))}%)`}
                  value={formatMoney(num(v.vatAmount), cur)}
                />
              )}
              <div className="flex justify-between border-t-2 border-double border-ink-800 pt-1 text-base font-bold">
                <dt>{isDealerChallan ? t("সর্বমোট চালান মূল্য") : t("সর্বমোট")}</dt>
                <dd className="tabular-nums">{formatMoney(amount, cur)}</dd>
              </div>
              {v.payments.length ? (
                v.payments.map((pm) => (
                  <Line
                    key={pm.id}
                    label={`${t("পরিশোধ")} — ${pm.account.name}${pm.reference ? ` (${pm.reference})` : ""}`}
                    value={formatMoney(num(pm.amount), cur)}
                  />
                ))
              ) : (
                <Line label={t("পরিশোধিত")} value={formatMoney(paid, cur)} />
              )}
              <Line
                label={t("বাকি")}
                value={formatMoney(Math.max(amount - paid, 0), cur)}
                strong
              />
            </dl>
          </div>
        )}

        {/* Amount in words & notes */}
        {!doRelease && (
          <p className="mt-4 rounded border border-rule bg-ink-50 px-3 py-2 text-sm">
            <b>{t("কথায়:")}</b> <AmountInWords amount={amount} />
          </p>
        )}
        {v.dueDate && amount - paid > 0 && (
          <p className="mt-2 text-sm">
            {t("বাকি পরিশোধের শেষ তারিখ:")} <b>{formatDate(v.dueDate)}</b>
          </p>
        )}
        {v.returnOf && (
          <p className="mt-2 text-sm">
            {t("মূল ইনভয়েস:")} {v.returnOf.voucherNo}
          </p>
        )}
        {v.narration && v.narration !== v.paddyPurchase?.notes && (
          <p className="mt-2 text-slate-600">
            {t("বিবরণ:")} {v.narration}
          </p>
        )}
        {v.type === "SALES" && b.invoiceTerms && (
          <p className="mt-3 whitespace-pre-line text-xs text-slate-500">
            {b.invoiceTerms}
          </p>
        )}

        {/* ── Signatures Footer */}
        {isDealerChallan ? (
          <footer className="mt-16 grid grid-cols-2 gap-16 text-center text-xs font-semibold text-slate-800 print:mt-12">
            <div>
              <div className="mx-auto max-w-[200px] border-t border-black pt-1.5">
                {t("গ্রহীতার স্বাক্ষর")}
              </div>
            </div>
            <div>
              <div className="mx-auto max-w-[200px] border-t border-black pt-1.5">
                {t("ডিপো ইনচার্জের স্বাক্ষর")}
              </div>
            </div>
          </footer>
        ) : (
          <footer className="mt-16 grid grid-cols-3 gap-8 text-center text-xs text-slate-600">
            <div className="border-t border-slate-500 pt-1">
              {t(
                v.depotDelivery
                  ? "ডিলারের স্বাক্ষর"
                  : v.type === "SALES"
                  ? "কাস্টমারের স্বাক্ষর"
                  : "গ্রহীতার স্বাক্ষর"
              )}
            </div>
            <div className="border-t border-slate-500 pt-1">
              {t("প্রস্তুতকারী")} ({v.createdBy.name})
            </div>
            <div className="border-t border-slate-500 pt-1">{t("অনুমোদনকারী")}</div>
          </footer>
        )}

        {v.type === "SALES" && b.invoiceFooter && (
          <p className="mt-6 text-center text-xs text-slate-500">{b.invoiceFooter}</p>
        )}
      </article>
    </>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt className="text-slate-600">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
