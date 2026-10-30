"use client";

// Depot delivery challan. Two modes:
//   কোম্পানি পেইড (ডিও রিলিজ)   company + dealer, rate = commission per unit → commission receivable, no dealer due
//   ডিপো কালেকশন (মার্কেট সেলস) dealer (or cash sale), rate = sale rate, collected now → the rest is market due
// Totals update while typing; the server recalculates when saving.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EntryDateInput } from "@/components/entry-date-input";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SubmitThenPrint } from "@/components/voucher-forms";
import { SearchSelect } from "@/components/search-select";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption, PartyOption, ProductOption, WarehouseOption } from "@/components/trade-parts";
import { challanTotals, DEPOT_MODE_LABELS, depotTotals, type DepotMode } from "@/lib/depot";
import { formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { round2 } from "@/lib/calc";
import { useT } from "@/components/lang";

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
/** the challan rate is the product's company price / DP (what the depot pays the company) */
const purchaseRate = (p: ProductOption | null) => (p && p.purchasePrice > 0 ? String(p.purchasePrice) : "");
/** DO release: the commission per unit; market sale: the depot product's dealer rate (else its DP) */
const rateFor = (mode: DepotMode, p: ProductOption | null) =>
  p ? (mode === "COMPANY_PAID" ? String(p.depotCommissionRate ?? 0) : p.salePrice > 0 ? String(p.salePrice) : purchaseRate(p)) : "";

export function DepotDeliveryForm({
  action,
  defaults,
  warehouses,
  cashAccounts,
  products = [],
  categories = [],
  multiWarehouse,
  currency,
  dateLocked,
  lockMode,
  cancelHref,
}: {
  action: FormAction;
  defaults: DepotDefaults;
  warehouses: WarehouseOption[];
  cashAccounts: AccountOption[];
  products?: ProductOption[];
  categories?: { id: string; name: string }[];
  multiWarehouse: boolean;
  currency: string;
  dateLocked?: boolean;
  /** editing: the mode of an existing challan cannot change */
  lockMode?: boolean;
  cancelHref: string;
}) {
  const t = useT();
  const [f, setF] = useState(defaults);
  const set = <K extends keyof DepotDefaults>(k: K, v: DepotDefaults[K]) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (key: number, patch: Partial<DepotLineState>) => setF((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const doRelease = f.mode === "COMPANY_PAID";
  const money = (v: number) => formatMoney(v, currency);
  const used = f.lines.filter((l) => l.product || l.quantity);
  const tTotals = depotTotals(used.map((l) => ({ quantity: n(l.quantity), freeQuantity: n(l.freeQuantity), rate: n(l.rate) })));
  // challan (dealer) amounts: supplied quantity × challan rate — on a market sale the sale rate is the challan rate
  const challanOf = (l: DepotLineState) => (doRelease ? l.challanRate : l.rate);
  const ch = challanTotals(used.map((l) => ({ quantity: n(l.quantity), challanRate: n(challanOf(l)) })));
  const cashSale = !doRelease && !f.dealer;
  const paid = doRelease ? 0 : cashSale ? tTotals.total : Math.min(n(f.paidAmount), tTotals.total);

  const [q, setQ] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = products;
    if (selectedCategory) {
      list = list.filter((p) => p.categoryId === selectedCategory);
    }
    if (s) {
      list = list.filter((p) =>
        `${p.name} ${p.code ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(s)
      );
    }
    return list.slice(0, 36);
  }, [q, selectedCategory, products]);

  function addProductFromGrid(p: ProductOption) {
    setF((x) => {
      if (x.lines.length === 1 && !x.lines[0].product && !x.lines[0].quantity) {
        return {
          ...x,
          lines: [
            {
              key: x.lines[0].key,
              product: p,
              quantity: "1",
              freeQuantity: "",
              rate: rateFor(x.mode, p),
              challanRate: purchaseRate(p),
            },
          ],
        };
      }
      const hit = x.lines.find((l) => l.product?.id === p.id);
      if (hit) {
        return {
          ...x,
          lines: x.lines.map((l) =>
            l.key === hit.key
              ? { ...l, quantity: String(round2(n(l.quantity) + 1)) }
              : l
          ),
        };
      }
      return {
        ...x,
        lines: [
          ...x.lines,
          {
            key: ++seq,
            product: p,
            quantity: "1",
            freeQuantity: "",
            rate: rateFor(x.mode, p),
            challanRate: purchaseRate(p),
          },
        ],
      };
    });
    setQ("");
    searchRef.current?.focus();
  }

  const payload = JSON.stringify({
    mode: f.mode, date: f.date, reference: null, narration: null, doNumber: f.doNumber || null,
    companyAccountId: doRelease ? f.company?.id ?? null : null, dealerAccountId: f.dealer?.id ?? null,
    warehouseId: multiWarehouse ? f.warehouseId || null : null, vehicleNo: f.vehicleNo || null, driverName: f.driverName || null, notes: f.notes || null,
    lines: used.map((l) => ({ productId: l.product?.id ?? "", quantity: l.quantity, freeQuantity: l.freeQuantity || 0, rate: l.rate || 0, challanRate: challanOf(l) || 0 })),
    paidAmount: doRelease ? 0 : cashSale ? tTotals.total : f.paidAmount || 0, cashAccountId: doRelease ? null : f.cashAccountId || null,
  });
  const switchMode = (mode: DepotMode) => setF((x) => ({ ...x, mode, lines: x.lines.map((l) => ({ ...l, rate: mode === "COMPANY_PAID" ? rateFor(mode, l.product) : l.challanRate || purchaseRate(l.product) })) }));

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold text-ink-800">{t("ডেলিভারির ধরন (পেমেন্ট / ডেলিভারি পদ্ধতি) *")}</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {(["COMPANY_PAID", "DEPOT_COLLECTION"] as const).map((m) => (
            <label key={m} className={`flex cursor-pointer gap-3 rounded-lg border-2 p-3 ${f.mode === m ? "border-brand-600 bg-brand-50" : "border-rule bg-white"} ${lockMode && f.mode !== m ? "cursor-not-allowed opacity-50" : ""}`}>
              <input type="radio" name="mode-choice" value={m} checked={f.mode === m} disabled={lockMode && f.mode !== m} onChange={() => switchMode(m)} className="mt-1" />
              <span>
                <span className="block font-semibold text-ink-900">{t(DEPOT_MODE_LABELS[m])}</span>
                <span className="block text-xs text-slate-600">
                  {m === "COMPANY_PAID"
                    ? t("ডিলার সরাসরি কোম্পানিকে টাকা দিয়েছে — ডিপো শুধু অনুমোদিত চালানে পণ্য দেবে। ডিলারের বকেয়া হবে না; কমিশন হারে কোম্পানির কাছে কমিশন প্রাপ্য জমা হবে।")
                    : t("ডিপো নিজে ডিলারের কাছে নগদ বা বাকিতে বিক্রি করবে — স্টক কমবে, ডিলারের লেজারে মার্কেট বাকি বা নগদ কালেকশন হবে।")}
                </span>
              </span>
            </label>
          ))}
        </div>
        {lockMode && <p className="mt-1 text-xs text-slate-500">{t("সংরক্ষিত চালানের ধরন পরিবর্তন করা যায় না।")}</p>}
        <FieldError name="mode" />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="তারিখ *" name="date"><EntryDateInput id="date" value={f.date} onChange={(v) => set("date", v)} locked={dateLocked} /></Field>
        <Field label={doRelease ? "ডিও / রিলিজ অর্ডার নং" : "চালান / রেফারেন্স নং"} name="doNumber">
          <input id="doNumber" className="input" maxLength={60} value={f.doNumber} onChange={(e) => set("doNumber", e.target.value)} placeholder={t(doRelease ? "কোম্পানির ডিও নম্বর" : "ঐচ্ছিক")} />
        </Field>
        {doRelease && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="company">{t("কোম্পানি (যার ডিও) *")}</label>
            <SearchSelect kind="suppliers" book="depot" id="company" value={f.company} onChange={(s) => set("company", s)} placeholder={t("কোম্পানির নাম খুঁজুন (সরবরাহকারী তালিকা)")} create={{}} currency={currency} />
            <FieldError name="companyAccountId" />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="dealer">{t("ডিলার")} {doRelease ? "*" : ""}</label>
          <SearchSelect kind="customers" book="depot" id="dealer" value={f.dealer} onChange={(s) => set("dealer", s)} noneLabel={doRelease ? undefined : t("নগদ বিক্রয় (ডিলার ছাড়া)")} placeholder={t("ডিপো ডিলারের নাম বা মোবাইল দিয়ে খুঁজুন")} create={{}} currency={currency} />
          <FieldError name="dealerAccountId" />
        </div>
        {multiWarehouse && (
          <Field label="গুদাম" name="warehouseId">
            <select id="warehouseId" className="input" value={f.warehouseId ?? ""} onChange={(e) => set("warehouseId", e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="গাড়ি নম্বর" name="vehicleNo"><input id="vehicleNo" className="input" maxLength={40} value={f.vehicleNo} onChange={(e) => set("vehicleNo", e.target.value)} placeholder={t("যেমন: দিনাজপুর-ট ১১-২২৩৩")} /></Field>
        <Field label="ড্রাইভার" name="driverName"><input id="driverName" className="input" maxLength={80} value={f.driverName} onChange={(e) => set("driverName", e.target.value)} placeholder={t("ড্রাইভারের নাম")} /></Field>
      </div>

      {/* ১. প্রোডাক্ট গ্রিড ও সার্চ ইন্টারফেস (POS Style Selection) */}
      <section className="panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={searchRef}
            className="input flex-1 text-base"
            placeholder={`🔍 ${t("পণ্যের নাম, কোড বা বারকোড স্ক্যান করুন — Enter")}  (F2)`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const s = q.trim().toLowerCase();
              const exact = products.find((p) => p.barcode?.toLowerCase() === s || p.code?.toLowerCase() === s);
              const pick = exact ?? (results.length === 1 ? results[0] : undefined);
              if (pick) addProductFromGrid(pick);
            }}
            aria-label={t("পণ্য খুঁজুন")}
          />

          <div className="flex items-center gap-1.5">
            <select
              className="input w-auto font-medium"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label={t("পণ্যের গ্রুপ")}
            >
              <option value="">{t("সকল গ্রুপ")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* প্রোডাক্ট কার্ডগুলোর গ্রিড */}
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 max-h-[380px] overflow-y-auto p-1">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addProductFromGrid(p)}
              className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-xs transition hover:border-brand-500 hover:bg-brand-50/50 hover:shadow-sm active:scale-[0.98]"
            >
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-1 flex-wrap">
                  {p.code ? (
                    <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-bold text-blue-700 ring-1 ring-inset ring-blue-600/20 tabular-nums">
                      {t("কোড: {0}", { 0: p.code })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {t("আইটেম")}
                    </span>
                  )}
                  {p.categoryName && (
                    <span className="truncate max-w-[80px] text-[10px] text-slate-400">
                      {p.categoryName}
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs font-bold text-slate-900 group-hover:text-brand-700">
                  {p.name}
                </p>
              </div>
              <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-baseline justify-between gap-1">
                <p className="text-sm font-bold tabular-nums text-brand-700">
                  {formatMoney(doRelease ? Number(p.depotCommissionRate ?? 0) : (p.salePrice || p.purchasePrice), currency)}
                </p>
                <p className="text-[10px] font-medium text-slate-500">
                  {t("মজুদ")} {formatQty(p.stock)}
                </p>
              </div>
            </button>
          ))}
          {results.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-slate-400">
              {t("কোনো পণ্য পাওয়া যায়নি")}
            </p>
          )}
        </div>
      </section>

      {/* ২. ডেলিভারি চালান পণ্য তালিকা (Cart Table) */}
      <section className="panel overflow-hidden border border-slate-200 shadow-xs">
        <div className="panel-head border-b border-slate-200 bg-slate-50/70 px-4 py-3 flex justify-between items-center">
          <h2 className="panel-title flex items-center gap-2">
            <span>{t("পণ্য তালিকা")}</span>
            <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-800">
              {toBnDigits(f.lines.filter((l) => l.product || l.quantity).length)}
            </span>
          </h2>
          {f.lines.length > 0 && (
            <button
              type="button"
              className="btn-ghost btn-sm text-credit hover:bg-rose-50"
              onClick={() => setF((x) => ({ ...x, lines: [] }))}
            >
              {t("সব মুছুন")}
            </button>
          )}
        </div>

        {f.lines.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-slate-400">
            {t("উপরে গ্রিড থেকে পণ্য বেছে নিন অথবা কোড/বারকোড স্ক্যান করে তালিকায় যোগ করুন")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full border-collapse min-w-[48rem]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-xs font-bold text-slate-700">
                  <th className="w-10 px-3 py-3 text-center">#</th>
                  <th className="min-w-48 px-3 py-3 text-left">{t("পণ্যের নাম ও কোড")}</th>
                  <th className="w-36 px-3 py-3 text-center">{t("মূল পরিমাণ")}</th>
                  <th className="w-28 px-3 py-3 text-center">{t("ফ্রি পরিমাণ")}</th>
                  <th className="w-32 px-3 py-3 text-right" title={t("পণ্যের সর্বশেষ ক্রয়মূল্য — চালানে ছাপা হবে")}>
                    {t("দর / রেট")}
                  </th>
                  <th className="w-36 px-3 py-3 text-right">{t("মোট টাকা")}</th>
                  <th className="w-10 px-2 py-3 text-center" aria-label={t("অ্যাকশন")} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {f.lines.map((l, i) => {
                  const short = l.product && (n(l.quantity) + n(l.freeQuantity)) > l.product.stock;

                  return (
                    <tr key={l.key} className="transition-colors hover:bg-slate-50/80">
                      {/* # */}
                      <td className="px-3 py-3 text-center text-xs font-semibold text-slate-500 tabular-nums">
                        {toBnDigits(i + 1)}
                      </td>

                      {/* পণ্যের নাম ও কোড */}
                      <td className="px-3 py-3">
                        {l.product ? (
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {l.product.code && (
                                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 ring-1 ring-inset ring-blue-600/20 tabular-nums">
                                  {l.product.code}
                                </span>
                              )}
                              <span className="font-semibold text-slate-900 leading-snug">{l.product.name}</span>
                            </div>
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {t("স্টক")}: {formatQty(l.product.stock)}
                              {n(l.freeQuantity) > 0 && (
                                <> · {t("স্টক থেকে বের হবে")}: {formatQty(n(l.quantity) + n(l.freeQuantity))}</>
                              )}
                            </span>
                            {short && (
                              <p className="mt-0.5 text-[11px] font-medium text-credit">
                                {t("মজুদ অপর্যাপ্ত")}
                              </p>
                            )}
                          </div>
                        ) : (
                          <SearchSelect<ProductOption>
                            kind="products"
                            book="depot"
                            id={`line-${i}`}
                            value={l.product}
                            onChange={(p) =>
                              setLine(l.key, {
                                product: p,
                                rate: rateFor(f.mode, p),
                                challanRate: purchaseRate(p),
                              })
                            }
                            placeholder={t("পণ্য খুঁজুন")}
                            currency={currency}
                          />
                        )}
                        <FieldError name={`lines.${i}.productId`} />
                      </td>

                      {/* মূল পরিমাণ */}
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-base font-bold text-slate-700 shadow-2xs hover:bg-slate-100 active:bg-slate-200"
                            aria-label={t("কমান")}
                            onClick={() =>
                              setLine(l.key, {
                                quantity: String(Math.max(round2(n(l.quantity) - 1), 0.001)),
                              })
                            }
                          >
                            −
                          </button>
                          <input
                            aria-label={t("পরিমাণ")}
                            className="input-num h-8 w-20 text-center font-bold text-slate-900"
                            type="text"
                            inputMode="decimal"
                            data-numeric
                            min="0"
                            step="any"
                            value={l.quantity}
                            onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                          />
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-base font-bold text-slate-700 shadow-2xs hover:bg-slate-100 active:bg-slate-200"
                            aria-label={t("বাড়ান")}
                            onClick={() =>
                              setLine(l.key, { quantity: String(round2(n(l.quantity) + 1)) })
                            }
                          >
                            +
                          </button>
                        </div>
                        <FieldError name={`lines.${i}.quantity`} />
                      </td>

                      {/* ফ্রি পরিমাণ */}
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center">
                          <input
                            aria-label={t("ফ্রি পরিমাণ")}
                            className="input-num h-8 w-20 text-center font-bold text-emerald-700 bg-emerald-50/50 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500/20"
                            type="text"
                            inputMode="decimal"
                            data-numeric
                            min="0"
                            step="any"
                            value={l.freeQuantity}
                            onChange={(e) => setLine(l.key, { freeQuantity: e.target.value })}
                            placeholder="০"
                          />
                        </div>
                        <FieldError name={`lines.${i}.freeQuantity`} />
                      </td>

                      {/* দর / রেট */}
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end">
                          {doRelease ? (
                            <input
                              aria-label={t("দর (ক্রয়মূল্য)")}
                              className="input-num h-8 w-24 text-right font-bold text-slate-900"
                              type="text"
                              inputMode="decimal"
                              data-numeric
                              min="0"
                              step="0.01"
                              value={l.challanRate}
                              onChange={(e) => setLine(l.key, { challanRate: e.target.value })}
                            />
                          ) : (
                            <input
                              aria-label={t("দর (ক্রয়মূল্য)")}
                              className="input-num h-8 w-24 text-right font-bold text-slate-900"
                              type="text"
                              inputMode="decimal"
                              data-numeric
                              min="0"
                              step="0.01"
                              value={l.rate}
                              onChange={(e) => setLine(l.key, { rate: e.target.value })}
                            />
                          )}
                        </div>
                        <FieldError name={`lines.${i}.${doRelease ? "challanRate" : "rate"}`} />
                      </td>

                      {/* মোট টাকা */}
                      <td className="px-3 py-3 text-right font-bold text-slate-900 text-sm whitespace-nowrap tabular-nums">
                        {money(ch.amounts[used.indexOf(l)] ?? 0)}
                      </td>

                      {/* রিমুভ বাটন */}
                      <td className="px-2 py-3 text-center">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-credit transition-colors"
                          aria-label={t("সারি মুছুন")}
                          onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((y) => y.key !== l.key) }))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-800 text-xs">
                  <td colSpan={2} className="px-3 py-3 text-left">
                    {t("মোট")}{" "}
                    <span className="block text-[11px] font-normal text-slate-500">
                      {t("স্টক থেকে বের হবে")}:{" "}
                      <span id="total-out" className="font-semibold text-slate-800">
                        {formatQty(tTotals.stockOut)}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center tabular-nums text-slate-900" id="total-qty">
                    {formatQty(tTotals.quantity)}
                  </td>
                  <td className="px-3 py-3 text-center tabular-nums text-emerald-700" id="total-free">
                    {formatQty(tTotals.free)}
                  </td>
                  <td />
                  <td className="px-3 py-3 text-right tabular-nums text-sm font-bold text-brand-900" id="total-amount">
                    {money(ch.total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-rule p-2.5">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine()] }))}
          >
            {t("+ আরেকটি পণ্য")}
          </button>
          <FieldError name="lines" />
        </div>
      </section>

      {doRelease ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" aria-live="polite">
          {t("ডিলারের কোনো বকেয়া হবে না · কোম্পানির কাছে কমিশন প্রাপ্য জমা হবে:")} <b id="commission-total">{money(tTotals.total)}</b>{tTotals.free > 0 && ` ${t("(ফ্রি পরিমাণে কমিশন নেই)")}`}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!cashSale && (
            <Field label="এখন কালেকশন (৳)" name="paidAmount">
              <input id="paidAmount" className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={f.paidAmount} onChange={(e) => set("paidAmount", e.target.value)} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="cashAccountId">{t("কালেকশনের হিসাব (নগদ/ব্যাংক)")}{cashSale ? " *" : ""}</label>
            <SearchableAccountSelect id="cashAccountId" scope="cash" book="depot" known={cashAccounts} value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)} currency={currency} />
            <FieldError name="cashAccountId" />
          </div>
          <p className="self-end rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" aria-live="polite">
            {cashSale ? t("নগদ বিক্রয় — পুরো টাকা কালেকশন") : <>{t("ডিলারের মার্কেট বাকি হবে:")} <b id="market-due">{money(Math.max(0, tTotals.total - paid))}</b></>}
          </p>
        </div>
      )}

      <Field label="নোট" name="notes"><textarea id="notes" rows={2} maxLength={500} className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("নোট বা মন্তব্য")} /></Field>

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">ডেলিভারি চালান সংরক্ষণ করুন</SubmitButton>
        <SubmitThenPrint label="সংরক্ষণ ও প্রিন্ট চালান (ডিলার কপি)" />
        <Link prefetch={false} href={cancelHref} className="btn-secondary">{t("বাতিল")}</Link>
      </div>
    </ActionForm>
  );
}

