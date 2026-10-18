"use client";

// Depot delivery challan. Two modes:
//   কোম্পানি পেইড (ডিও রিলিজ)   company + dealer, rate = commission per unit → commission receivable, no dealer due
//   ডিপো কালেকশন (মার্কেট সেলস) dealer (or cash sale), rate = sale rate, collected now → the rest is market due
// Totals update while typing; the server recalculates when saving.
import Link from "next/link";
import { useState } from "react";
import { EntryDateInput } from "@/components/entry-date-input";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SubmitThenPrint } from "@/components/voucher-forms";
import { SearchSelect } from "@/components/search-select";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption, PartyOption, ProductOption, WarehouseOption } from "@/components/trade-parts";
import { challanTotals, DEPOT_MODE_LABELS, depotTotals, type DepotMode } from "@/lib/depot";
import { formatMoney, formatQty } from "@/lib/format";

export interface DepotLineState {
  key: number;
  product: ProductOption | null;
  quantity: string;
  /** free / scheme quantity — leaves the stock, never billed */
  freeQuantity: string;
  /** DO release: commission per unit; market sale: the sale rate (= the challan rate) */
  rate: string;
  /** dealer challan rate — the product's latest purchase price, filled in when the product is chosen */
  challanRate: string;
}

export interface DepotDefaults {
  mode: DepotMode;
  date: string;
  doNumber: string;
  company: PartyOption | null;
  dealer: PartyOption | null;
  warehouseId: string | null;
  vehicleNo: string;
  driverName: string;
  notes: string;
  lines: DepotLineState[];
  paidAmount: string;
  cashAccountId: string;
}

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
let seq = 1000;
const blankLine = (): DepotLineState => ({ key: ++seq, product: null, quantity: "", freeQuantity: "", rate: "", challanRate: "" });
/** the delivery rate is the product's latest purchase price (what the depot pays the company) */
const purchaseRate = (p: ProductOption | null) => (p && p.purchasePrice > 0 ? String(p.purchasePrice) : "");
const rateFor = (mode: DepotMode, p: ProductOption | null) => (p ? (mode === "COMPANY_PAID" ? String(p.depotCommissionRate ?? 0) : purchaseRate(p)) : "");

export function DepotDeliveryForm({ action, defaults, warehouses, cashAccounts, multiWarehouse, currency, dateLocked, lockMode, cancelHref }: {
  action: FormAction;
  defaults: DepotDefaults;
  warehouses: WarehouseOption[];
  cashAccounts: AccountOption[];
  multiWarehouse: boolean;
  currency: string;
  dateLocked?: boolean;
  /** editing: the mode of an existing challan cannot change */
  lockMode?: boolean;
  cancelHref: string;
}) {
  const [f, setF] = useState(defaults);
  const set = <K extends keyof DepotDefaults>(k: K, v: DepotDefaults[K]) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (key: number, patch: Partial<DepotLineState>) => setF((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const doRelease = f.mode === "COMPANY_PAID";
  const money = (v: number) => formatMoney(v, currency);
  const used = f.lines.filter((l) => l.product || l.quantity);
  const t = depotTotals(used.map((l) => ({ quantity: n(l.quantity), freeQuantity: n(l.freeQuantity), rate: n(l.rate) })));
  // challan (dealer) amounts: supplied quantity × challan rate — on a market sale the sale rate is the challan rate
  const challanOf = (l: DepotLineState) => (doRelease ? l.challanRate : l.rate);
  const ch = challanTotals(used.map((l) => ({ quantity: n(l.quantity), challanRate: n(challanOf(l)) })));
  const cashSale = !doRelease && !f.dealer;
  const paid = doRelease ? 0 : cashSale ? t.total : Math.min(n(f.paidAmount), t.total);
  const payload = JSON.stringify({
    mode: f.mode, date: f.date, reference: null, narration: null, doNumber: f.doNumber || null,
    companyAccountId: doRelease ? f.company?.id ?? null : null, dealerAccountId: f.dealer?.id ?? null,
    warehouseId: multiWarehouse ? f.warehouseId || null : null, vehicleNo: f.vehicleNo || null, driverName: f.driverName || null, notes: f.notes || null,
    lines: used.map((l) => ({ productId: l.product?.id ?? "", quantity: l.quantity, freeQuantity: l.freeQuantity || 0, rate: l.rate || 0, challanRate: challanOf(l) || 0 })),
    paidAmount: doRelease ? 0 : cashSale ? t.total : f.paidAmount || 0, cashAccountId: doRelease ? null : f.cashAccountId || null,
  });
  const switchMode = (mode: DepotMode) => setF((x) => ({ ...x, mode, lines: x.lines.map((l) => ({ ...l, rate: mode === "COMPANY_PAID" ? rateFor(mode, l.product) : l.challanRate || purchaseRate(l.product) })) }));

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold text-ink-800">ডেলিভারির ধরন (পেমেন্ট / ডেলিভারি পদ্ধতি) *</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {(["COMPANY_PAID", "DEPOT_COLLECTION"] as const).map((m) => (
            <label key={m} className={`flex cursor-pointer gap-3 rounded-lg border-2 p-3 ${f.mode === m ? "border-brand-600 bg-brand-50" : "border-rule bg-white"} ${lockMode && f.mode !== m ? "cursor-not-allowed opacity-50" : ""}`}>
              <input type="radio" name="mode-choice" value={m} checked={f.mode === m} disabled={lockMode && f.mode !== m} onChange={() => switchMode(m)} className="mt-1" />
              <span>
                <span className="block font-semibold text-ink-900">{DEPOT_MODE_LABELS[m]}</span>
                <span className="block text-xs text-slate-600">
                  {m === "COMPANY_PAID"
                    ? "ডিলার সরাসরি কোম্পানিকে টাকা দিয়েছে — ডিপো শুধু অনুমোদিত চালানে পণ্য দেবে। ডিলারের বকেয়া হবে না; কমিশন হারে কোম্পানির কাছে কমিশন প্রাপ্য জমা হবে।"
                    : "ডিপো নিজে ডিলারের কাছে নগদ বা বাকিতে বিক্রি করবে — স্টক কমবে, ডিলারের লেজারে মার্কেট বাকি বা নগদ কালেকশন হবে।"}
                </span>
              </span>
            </label>
          ))}
        </div>
        {lockMode && <p className="mt-1 text-xs text-slate-500">সংরক্ষিত চালানের ধরন পরিবর্তন করা যায় না।</p>}
        <FieldError name="mode" />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="তারিখ *" name="date"><EntryDateInput id="date" value={f.date} onChange={(v) => set("date", v)} locked={dateLocked} /></Field>
        <Field label={doRelease ? "ডিও / রিলিজ অর্ডার নং" : "চালান / রেফারেন্স নং"} name="doNumber">
          <input id="doNumber" className="input" maxLength={60} value={f.doNumber} onChange={(e) => set("doNumber", e.target.value)} placeholder={doRelease ? "কোম্পানির ডিও নম্বর" : "ঐচ্ছিক"} />
        </Field>
        {doRelease && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="company">কোম্পানি (যার ডিও) *</label>
            <SearchSelect kind="suppliers" book="depot" id="company" value={f.company} onChange={(s) => set("company", s)} placeholder="কোম্পানির নাম খুঁজুন (সরবরাহকারী তালিকা)" create={{}} currency={currency} />
            <FieldError name="companyAccountId" />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="dealer">ডিলার {doRelease ? "*" : ""}</label>
          <SearchSelect kind="customers" book="depot" id="dealer" value={f.dealer} onChange={(s) => set("dealer", s)} noneLabel={doRelease ? undefined : "নগদ বিক্রয় (ডিলার ছাড়া)"} placeholder="ডিপো ডিলারের নাম বা মোবাইল দিয়ে খুঁজুন" create={{}} currency={currency} />
          <FieldError name="dealerAccountId" />
        </div>
        {multiWarehouse && (
          <Field label="গুদাম" name="warehouseId">
            <select id="warehouseId" className="input" value={f.warehouseId ?? ""} onChange={(e) => set("warehouseId", e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="গাড়ি নম্বর" name="vehicleNo"><input id="vehicleNo" className="input" maxLength={40} value={f.vehicleNo} onChange={(e) => set("vehicleNo", e.target.value)} placeholder="যেমন: দিনাজপুর-ট ১১-২২৩৩" /></Field>
        <Field label="ড্রাইভার" name="driverName"><input id="driverName" className="input" maxLength={80} value={f.driverName} onChange={(e) => set("driverName", e.target.value)} /></Field>
      </div>

      <section className="min-w-0 rounded-lg border border-rule" aria-label="পণ্য">
        <div className="overflow-x-auto">
          <table className={`table ${doRelease ? "min-w-[62rem]" : "min-w-[48rem]"}`}>
            <thead>
              <tr>
                <th className="w-[30%]">পণ্য</th>
                <th className="text-right">মূল পরিমাণ</th>
                <th className="text-right">ফ্রি পরিমাণ</th>
                <th className="text-right" title="পণ্যের সর্বশেষ ক্রয়মূল্য — চালানে ছাপা হবে">দর (ক্রয়মূল্য)</th>
                <th className="text-right">মোট টাকা</th>
                {doRelease && <th className="text-right" title="ডিপোর অভ্যন্তরীণ — ডিলার কপিতে ছাপা হবে না">কমিশন হার</th>}
                {doRelease && <th className="text-right">কমিশন</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l, i) => (
                <tr key={l.key}>
                  <td>
                    <SearchSelect kind="products" id={`line-${i}`} value={l.product} onChange={(p) => setLine(l.key, { product: p, rate: rateFor(f.mode, p), challanRate: purchaseRate(p) })} placeholder="পণ্য খুঁজুন" currency={currency} />
                    <FieldError name={`lines.${i}.productId`} />
                    {l.product && <span className="mt-0.5 block text-[11px] text-slate-500">স্টক: {formatQty(l.product.stock)}{n(l.freeQuantity) > 0 && <> · স্টক থেকে বের হবে: {formatQty(n(l.quantity) + n(l.freeQuantity))}</>}</span>}
                  </td>
                  <td>
                    <input aria-label="পরিমাণ" className="input-num" type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                    <FieldError name={`lines.${i}.quantity`} />
                  </td>
                  <td>
                    <input aria-label="ফ্রি পরিমাণ" className="input-num border-amber-300 bg-amber-50" type="number" min="0" step="any" value={l.freeQuantity} onChange={(e) => setLine(l.key, { freeQuantity: e.target.value })} placeholder="০" />
                    <FieldError name={`lines.${i}.freeQuantity`} />
                  </td>
                  <td>
                    {doRelease ? (
                      <input aria-label="দর (ক্রয়মূল্য)" className="input-num" type="number" min="0" step="0.01" value={l.challanRate} onChange={(e) => setLine(l.key, { challanRate: e.target.value })} />
                    ) : (
                      <input aria-label="দর (ক্রয়মূল্য)" className="input-num" type="number" min="0" step="0.01" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} />
                    )}
                    <FieldError name={`lines.${i}.${doRelease ? "challanRate" : "rate"}`} />
                  </td>
                  <td className="num font-semibold">{money(ch.amounts[used.indexOf(l)] ?? 0)}</td>
                  {doRelease && (
                    <td>
                      <input aria-label="কমিশন হার" className="input-num" type="number" min="0" step="0.01" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} />
                      <FieldError name={`lines.${i}.rate`} />
                    </td>
                  )}
                  {doRelease && <td className="num text-slate-600">{money(t.amounts[used.indexOf(l)] ?? 0)}</td>}
                  <td>
                    {f.lines.length > 1 && (
                      <button type="button" className="btn-ghost px-2" aria-label="সারি মুছুন" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((y) => y.key !== l.key) }))}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>মোট <span className="block text-[11px] font-normal text-slate-500">স্টক থেকে বের হবে: <span id="total-out">{formatQty(t.stockOut)}</span></span></td>
                <td className="num" id="total-qty">{formatQty(t.quantity)}</td>
                <td className="num text-amber-800" id="total-free">{formatQty(t.free)}</td>
                <td />
                <td className="num" id="total-amount">{money(ch.total)}</td>
                {doRelease && <td />}
                {doRelease && <td className="num text-slate-600" id="total-commission">{money(t.total)}</td>}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-rule p-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine()] }))}>+ আরেকটি পণ্য</button>
          <FieldError name="lines" />
        </div>
      </section>

      {doRelease ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" aria-live="polite">
          ডিলারের কোনো বকেয়া হবে না · কোম্পানির কাছে কমিশন প্রাপ্য জমা হবে: <b id="commission-total">{money(t.total)}</b>{t.free > 0 && " (ফ্রি পরিমাণে কমিশন নেই)"}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!cashSale && (
            <Field label="এখন কালেকশন (৳)" name="paidAmount">
              <input id="paidAmount" className="input-num" type="number" min="0" step="0.01" value={f.paidAmount} onChange={(e) => set("paidAmount", e.target.value)} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="cashAccountId">কালেকশনের হিসাব (নগদ/ব্যাংক){cashSale ? " *" : ""}</label>
            <SearchableAccountSelect id="cashAccountId" scope="cash" book="depot" known={cashAccounts} value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)} currency={currency} />
            <FieldError name="cashAccountId" />
          </div>
          <p className="self-end rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" aria-live="polite">
            {cashSale ? "নগদ বিক্রয় — পুরো টাকা কালেকশন" : <>ডিলারের মার্কেট বাকি হবে: <b id="market-due">{money(Math.max(0, t.total - paid))}</b></>}
          </p>
        </div>
      )}

      <Field label="নোট" name="notes"><textarea id="notes" rows={2} maxLength={500} className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">ডেলিভারি চালান সংরক্ষণ করুন</SubmitButton>
        <SubmitThenPrint label="সংরক্ষণ ও প্রিন্ট চালান (ডিলার কপি)" />
        <Link prefetch={false} href={cancelHref} className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

