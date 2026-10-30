"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { unitConversionFactor } from "@/lib/accounting";
import { computeTotals, lineAmount, round2 } from "@/lib/calc";
import { formatDrCr, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { SearchSelect } from "./search-select";
import { EntryDateInput } from "./entry-date-input";
import { ActionForm, FieldError, SubmitButton, useFormCtx, type FormAction } from "./forms";
import { SearchableAccountSelect, type AccountItem } from "./account-select";
import { useT } from "./lang";
import {
  BatchCell,
  nextKey,
  PartyInfo,
  PaymentRows,
  paymentsPayload,
  type AccountOption,
  type BatchOption,
  type PartyOption,
  type PaymentRow,
  type ProductOption,
  type UnitOption,
  type WarehouseOption,
} from "./trade-parts";

export type { AccountOption, ProductOption, UnitOption, WarehouseOption, BatchOption, PartyOption };

function Header({ date, setDate, reference, setReference, dateLocked }: { date: string; setDate: (v: string) => void; reference: string; setReference: (v: string) => void; dateLocked?: boolean }) {
  const t = useT();
  return (
    <>
      <div>
        <label className="label" htmlFor="v-date">{t("তারিখ *")}</label>
        <EntryDateInput id="v-date" value={date} onChange={setDate} locked={dateLocked} />
        <FieldError name="date" />
      </div>
      <div>
        <label className="label" htmlFor="v-ref">{t("রেফারেন্স")}</label>
        <input id="v-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("চালান/চেক/মেমো নং")} />
      </div>
    </>
  );
}

function Footer({ cancelHref, label, disabled, extra }: { cancelHref: string; label: string; disabled?: boolean; extra?: React.ReactNode }) {
  const { pending } = useFormCtx();
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {disabled ? <button type="button" className="btn-primary" disabled>{t(label)}</button> : <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">{t(label)}</SubmitButton>}
      {extra}
      <Link prefetch={false} href={cancelHref} className={`btn-secondary ${pending ? "pointer-events-none opacity-60" : ""}`}>{t("বাতিল")}</Link>
    </div>
  );
}

// ───────────────────────── trade: sales / purchase / returns ─────────────────────────

export interface TradeDefaults {
  date: string;
  /** no transaction:change_date permission: the date is fixed */
  dateLocked?: boolean;
  reference: string;
  narration: string;
  partyAccountId: string;
  warehouseId: string;
  discount: number;
  vatPercent: number;
  dueDate: string;
  returnOfId: string;
  returnOfNo: string;
  payments: { accountId: string; amount: number; reference: string }[];
  items: { productId: string; unitId: string; quantity: number; freeQuantity?: number; rate: number; discount: number; batchNo: string; expiryDate: string; mfgDate?: string; maxQty?: number }[];
}

interface TradeLine {
  key: number;
  productId: string;
  unitId: string;
  quantity: string;
  freeQuantity: string;
  rate: string;
  discount: string;
  batchNo: string;
  expiryDate: string;
  mfgDate: string;
  maxQty?: number;
}

export function TradeVoucherForm({
  kind,
  action,
  parties,
  cashAccounts,
  warehouses,
  products,
  categories = [],
  units,
  batches,
  defaults,
  currency,
  cancelHref,
  allowExpiredSale = false,
  showFree = false,
  book,
  productGrid = false,
}: {
  kind: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";
  action: FormAction;
  parties: PartyOption[];
  cashAccounts: AccountOption[];
  warehouses: WarehouseOption[];
  products: ProductOption[];
  categories?: { id: string; name: string }[];
  units: UnitOption[];
  batches: BatchOption[];
  defaults: TradeDefaults;
  currency: string;
  cancelHref: string;
  allowExpiredSale?: boolean;
  /** depot: free / scheme quantity column (purchase and sales) */
  showFree?: boolean;
  /** "depot": a depot-book voucher — dealers instead of customers, depot-book balances */
  book?: "depot";
  /** POS / Dealer challan style product cards grid and cart table */
  productGrid?: boolean;
}) {
  const isSale = kind === "SALES" || kind === "SALES_RETURN";
  const outgoing = kind === "SALES" || kind === "PURCHASE_RETURN";
  // products known on the client: those already on the voucher + every product picked since
  const [productMap, setProductMap] = useState(() => new Map(products.map((p) => [p.id, p])));
  const remember = (p: ProductOption) => setProductMap((m) => new Map(m).set(p.id, p));
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const lockedToInvoice = !!defaults.returnOfId;

  const t = useT();
  const [date, setDate] = useState(defaults.date);
  const [reference, setReference] = useState(defaults.reference);
  const [narration, setNarration] = useState(defaults.narration);
  const [party, setParty] = useState<PartyOption | null>(() => parties.find((p) => p.id === defaults.partyAccountId) ?? null);
  const partyId = party?.id ?? "";
  const [warehouseId, setWarehouseId] = useState(defaults.warehouseId || warehouses[0]?.id || "");
  const [discount, setDiscount] = useState(String(defaults.discount));
  const [vat, setVat] = useState(String(defaults.vatPercent));
  const [dueDate, setDueDate] = useState(defaults.dueDate);
  const [payments, setPayments] = useState<PaymentRow[]>(defaults.payments.map((p) => ({ key: nextKey(), accountId: p.accountId, amount: String(p.amount), reference: p.reference })));
  const [priceMode, setPriceMode] = useState<"retail" | "wholesale">("retail");
  const [lines, setLines] = useState<TradeLine[]>(
    defaults.items.length
      ? defaults.items.map((i) => ({ key: nextKey(), productId: i.productId, unitId: i.unitId, quantity: String(i.quantity), freeQuantity: i.freeQuantity ? String(i.freeQuantity) : "", rate: String(i.rate), discount: i.discount ? String(i.discount) : "", batchNo: i.batchNo, expiryDate: i.expiryDate, mfgDate: i.mfgDate ?? "", maxQty: i.maxQty }))
      : productGrid
        ? []
        : [{ key: nextKey(), productId: "", unitId: "", quantity: "1", freeQuantity: "", rate: "", discount: "", batchNo: "", expiryDate: "", mfgDate: "" }],
  );

  const [q, setQ] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!productGrid) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [productGrid]);

  const results = useMemo(() => {
    if (!productGrid) return [];
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
  }, [productGrid, q, selectedCategory, products]);

  function addProductFromGrid(p: ProductOption) {
    remember(p);
    setLines((ls) => {
      if (ls.length === 1 && !ls[0].productId) {
        return [
          {
            key: ls[0].key,
            productId: p.id,
            unitId: p.unitId,
            quantity: "1",
            freeQuantity: "",
            rate: String(baseRate(p) || ""),
            discount: "",
            batchNo: "",
            expiryDate: "",
            mfgDate: "",
          },
        ];
      }
      const hit = ls.find((l) => l.productId === p.id && l.unitId === p.unitId);
      if (hit) {
        return ls.map((l) =>
          l.key === hit.key
            ? { ...l, quantity: String(round2((Number(l.quantity) || 0) + 1)) }
            : l
        );
      }
      return [
        ...ls,
        {
          key: nextKey(),
          productId: p.id,
          unitId: p.unitId,
          quantity: "1",
          freeQuantity: "",
          rate: String(baseRate(p) || ""),
          discount: "",
          batchNo: "",
          expiryDate: "",
          mfgDate: "",
        },
      ];
    });
    setQ("");
    searchRef.current?.focus();
  }

  const compatibleUnits = (productId: string) => {
    const p = productMap.get(productId);
    if (!p) return [];
    const pu = unitMap.get(p.unitId)!;
    return units.filter((u) => unitConversionFactor(u, pu) !== null);
  };
  const factorOf = (l: TradeLine) => {
    const p = productMap.get(l.productId);
    const u = unitMap.get(l.unitId);
    if (!p || !u) return 1;
    return unitConversionFactor(u, unitMap.get(p.unitId)!) ?? 1;
  };
  const baseRate = (p: ProductOption) => (kind === "PURCHASE" || kind === "PURCHASE_RETURN" ? p.purchasePrice : priceMode === "wholesale" && p.wholesalePrice ? p.wholesalePrice : p.salePrice);
  const update = (key: number, patch: Partial<TradeLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totals = computeTotals(
    lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.rate) || 0, discount: Number(l.discount) || 0 })),
    Number(discount) || 0,
    kind === "SALES" ? Number(vat) || 0 : 0,
  );
  const pay = paymentsPayload(payments);
  const paid = round2(pay.reduce((s, p) => s + p.amount, 0));
  const due = round2(totals.total - paid);
  const projectedDue = kind === "SALES" && party ? round2((party.balance ?? 0) + due) : undefined;

  const payload = JSON.stringify({
    date, reference, narration, partyAccountId: partyId || null, warehouseId,
    returnOfId: defaults.returnOfId || null, dueDate: dueDate || null,
    discount: Number(discount) || 0, vatPercent: kind === "SALES" ? Number(vat) || 0 : 0,
    payments: pay,
    items: lines.filter((l) => l.productId).map((l) => ({
      productId: l.productId, unitId: l.unitId || null, quantity: Number(l.quantity) || 0, ...(showFree ? { freeQuantity: Number(l.freeQuantity) || 0 } : {}), rate: Number(l.rate) || 0, discount: Number(l.discount) || 0,
      batchNo: l.batchNo || null, expiryDate: l.expiryDate || null, mfgDate: l.mfgDate || null,
    })),
  });
  const payLabel = kind === "SALES" ? "আদায় (নগদ/ব্যাংক/মোবাইল)" : kind === "PURCHASE" ? "পরিশোধ (নগদ/ব্যাংক/মোবাইল)" : kind === "SALES_RETURN" ? "ফেরত প্রদান" : "ফেরত প্রাপ্তি";

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      {lockedToInvoice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {t("মূল ইনভয়েস {0} এর বিপরীতে ফেরত — সর্বোচ্চ বিক্রিত/ক্রয়কৃত অবশিষ্ট পরিমাণ পর্যন্ত। স্টক ও হিসাব স্বয়ংক্রিয়ভাবে উল্টানো হবে।", { "0": defaults.returnOfNo ?? "" })}
        </div>
      )}

      <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="v-party">{t(isSale ? "কাস্টমার" : "সরবরাহকারী")}</label>
          <SearchSelect
            kind={isSale ? "customers" : "suppliers"}
            book={book}
            id="v-party"
            value={party}
            onChange={setParty}
            noneLabel={t(isSale ? "নগদ কাস্টমার (ওয়াক-ইন)" : "নগদ ক্রয় (সরবরাহকারী ছাড়া)")}
            disabled={lockedToInvoice}
            create={lockedToInvoice ? false : {}}
            currency={currency}
            ariaLabel={t(isSale ? "কাস্টমার" : "সরবরাহকারী")}
          />
          <PartyInfo party={party ?? undefined} currency={currency} projectedDue={projectedDue} />
          <FieldError name="partyAccountId" />
        </div>
        <Header date={date} setDate={setDate} reference={reference} setReference={setReference} dateLocked={defaults.dateLocked} />
        <div>
          <label className="label" htmlFor="v-wh">{t("গুদাম")}</label>
          <select id="v-wh" className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        {(kind === "SALES" || kind === "PURCHASE") && (
          <div>
            <label className="label" htmlFor="v-due">{t("পরিশোধের শেষ তারিখ")}</label>
            <input id="v-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} title={t("ফাঁকা থাকলে পার্টির ক্রেডিট দিন অনুযায়ী")} />
          </div>
        )}
      </section>

      {productGrid ? (
        <div className="space-y-4">
          {/* ১. প্রোডাক্ট গ্রিড ও সার্চ সেকশন (POS / Dealer Challan Style) */}
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
                      {formatMoney(baseRate(p), currency)}
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

          {/* ২. পণ্য তালিকা ও এন্ট্রি টেবিল (Cart Table) */}
          <section className="panel overflow-hidden border border-slate-200 shadow-xs">
            <div className="panel-head border-b border-slate-200 bg-slate-50/70 px-4 py-3 flex justify-between items-center">
              <h2 className="panel-title flex items-center gap-2">
                <span>{t("পণ্য তালিকা")}</span>
                <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-800">
                  {toBnDigits(lines.filter((l) => l.productId).length)}
                </span>
              </h2>
              {lines.filter((l) => l.productId).length > 0 && (
                <button
                  type="button"
                  className="btn-ghost btn-sm text-credit hover:bg-rose-50"
                  onClick={() => setLines([])}
                >
                  {t("সব মুছুন")}
                </button>
              )}
            </div>

            {lines.filter((l) => l.productId).length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-slate-400">
                {t("উপরে গ্রিড থেকে পণ্য বেছে নিন অথবা কোড/বারকোড স্ক্যান করে তালিকায় যোগ করুন")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100 text-xs font-bold text-slate-700">
                      <th className="w-10 px-3 py-3 text-center">#</th>
                      <th className="min-w-48 px-3 py-3 text-left">{t("পণ্যের নাম ও কোড")}</th>
                      <th className="w-36 px-3 py-3 text-left">{t("ব্যাচ / মেয়াদ")}</th>
                      <th className="w-28 px-3 py-3 text-left">{t("ইউনিট")}</th>
                      <th className="w-36 px-3 py-3 text-center">{t("পরিমাণ")}</th>
                      <th className="w-28 px-3 py-3 text-center">{t("ফ্রি পরিমাণ")}</th>
                      <th className="w-28 px-3 py-3 text-right">{t("ক্রয় দর")}</th>
                      <th className="w-32 px-3 py-3 text-right">{t("মোট টাকা")}</th>
                      <th className="w-10 px-2 py-3 text-center" aria-label={t("অ্যাকশন")} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {lines.filter((l) => l.productId).map((l, idx) => {
                      const p = productMap.get(l.productId);
                      const lineTotal = round2((Number(l.quantity) || 0) * (Number(l.rate) || 0));

                      return (
                        <tr key={l.key} className="transition-colors hover:bg-slate-50/80">
                          {/* ১. নম্বর */}
                          <td className="px-3 py-3 text-center text-xs font-semibold text-slate-500 tabular-nums">
                            {toBnDigits(idx + 1)}
                          </td>

                          {/* ২. পণ্যের নাম ও কোড */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {p?.code && (
                                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 ring-1 ring-inset ring-blue-600/20 tabular-nums">
                                  {p.code}
                                </span>
                              )}
                              <span className="font-semibold text-slate-900 leading-snug">{p?.name ?? "—"}</span>
                            </div>
                            <FieldError name={`items.${idx}.productId`} />
                          </td>

                          {/* ৩. ব্যাচ / মেয়াদ */}
                          <td className="px-3 py-3">
                            <BatchCell
                              product={p}
                              inbound={!outgoing}
                              batches={batches}
                              warehouseId={warehouseId}
                              batchNo={l.batchNo}
                              expiryDate={l.expiryDate}
                              mfgDate={l.mfgDate}
                              fefo={false}
                              onChange={(patch) => update(l.key, patch)}
                            />
                          </td>

                          {/* ৪. ইউনিট */}
                          <td className="px-3 py-3">
                            <select
                              className="input py-1 text-xs"
                              value={l.unitId}
                              disabled={!p}
                              onChange={(e) => {
                                const nu = unitMap.get(e.target.value);
                                const old = factorOf(l);
                                const nf = p && nu ? unitConversionFactor(nu, unitMap.get(p.unitId)!) ?? 1 : 1;
                                update(l.key, { unitId: e.target.value, rate: l.rate ? String(round2((Number(l.rate) / old) * nf)) : l.rate });
                              }}
                            >
                              {compatibleUnits(l.productId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </td>

                          {/* ৫. পরিমাণ (Qty) */}
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-base font-bold text-slate-700 shadow-2xs hover:bg-slate-100 active:bg-slate-200"
                                aria-label={t("কমান")}
                                onClick={() => update(l.key, { quantity: String(Math.max(round2((Number(l.quantity) || 0) - 1), 0.001)) })}
                              >
                                −
                              </button>
                              <input
                                className="input-num h-8 w-20 text-center font-bold text-slate-900"
                                type="text"
                                inputMode="decimal"
                                data-numeric
                                min="0"
                                step="0.001"
                                value={l.quantity}
                                onChange={(e) => update(l.key, { quantity: e.target.value })}
                                aria-label={t("পরিমাণ")}
                              />
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-base font-bold text-slate-700 shadow-2xs hover:bg-slate-100 active:bg-slate-200"
                                aria-label={t("বাড়ান")}
                                onClick={() => update(l.key, { quantity: String(round2((Number(l.quantity) || 0) + 1)) })}
                              >
                                +
                              </button>
                            </div>
                            <FieldError name={`items.${idx}.quantity`} />
                          </td>

                          {/* ৬. ফ্রি পরিমাণ (Free Qty) */}
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-center">
                              <input
                                className="input-num h-8 w-20 text-center font-bold text-emerald-700 bg-emerald-50/50 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500/20"
                                type="text"
                                inputMode="decimal"
                                data-numeric
                                min="0"
                                step="0.001"
                                placeholder="0"
                                value={l.freeQuantity}
                                onChange={(e) => update(l.key, { freeQuantity: e.target.value })}
                                aria-label={t("ফ্রি পরিমাণ")}
                              />
                            </div>
                            <FieldError name={`items.${idx}.freeQuantity`} />
                          </td>

                          {/* ৭. ক্রয় দর (Rate) */}
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end">
                              <input
                                className="input-num h-8 w-24 text-right font-bold text-slate-900"
                                type="text"
                                inputMode="decimal"
                                data-numeric
                                min="0"
                                step="0.01"
                                value={l.rate}
                                onChange={(e) => update(l.key, { rate: e.target.value })}
                                aria-label={t("ক্রয় দর")}
                              />
                            </div>
                            <FieldError name={`items.${idx}.rate`} />
                          </td>

                          {/* ৮. মোট টাকা (Line Total = পরিমাণ × দর) */}
                          <td className="px-3 py-3 text-right font-bold text-slate-900 text-sm whitespace-nowrap tabular-nums">
                            {formatMoney(lineTotal, currency)}
                          </td>

                          {/* ৯. রিমুভ বাটন */}
                          <td className="px-2 py-3 text-center">
                            <button
                              type="button"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-credit transition-colors"
                              aria-label={t("সারি মুছুন")}
                              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
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
                      <td colSpan={4} className="px-3 py-3 text-right">{t("মোট")}:</td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-900">
                        {formatQty(lines.filter((l) => l.productId).reduce((s, x) => s + (Number(x.quantity) || 0), 0))}
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-emerald-700">
                        {formatQty(lines.filter((l) => l.productId).reduce((s, x) => s + (Number(x.freeQuantity) || 0), 0))}
                      </td>
                      <td className="px-3 py-3 text-right" />
                      <td className="px-3 py-3 text-right tabular-nums text-sm font-bold text-brand-900">
                        {formatMoney(totals.subtotal, currency)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="px-4 pb-2">
              <FieldError name="items" />
            </div>
          </section>
        </div>
      ) : (
        <section className="panel">
          <div className="panel-head flex-wrap">
            <h2 className="panel-title">{t("পণ্য")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {kind === "SALES" && (
                <select className="input w-auto py-1 text-xs" value={priceMode} onChange={(e) => setPriceMode(e.target.value as "retail" | "wholesale")} aria-label={t("মূল্য ধরন")}>
                  <option value="retail">{t("খুচরা মূল্য")}</option>
                  <option value="wholesale">{t("পাইকারি মূল্য")}</option>
                </select>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th className="min-w-56">{t("পণ্য")}</th>
                  <th className="w-40">{t("ব্যাচ / মেয়াদ")}</th>
                  <th className="w-32">{t("ইউনিট")}</th>
                  <th className="w-28 text-right">{t("পরিমাণ")}</th>
                  {showFree && <th className="w-24 text-right" title={t("ফ্রি / স্কিম — স্টকে যোগ/বাদ হবে, দাম ধরা হবে না")}>{t("ফ্রি")}</th>}
                  <th className="w-32 text-right">{t("দর")}</th>
                  <th className="w-28 text-right">{t("ছাড়")}</th>
                  <th className="w-36 text-right">{t("মোট")}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const p = productMap.get(l.productId);
                  const baseQty = (Number(l.quantity) || 0) * factorOf(l);
                  const short = outgoing && p && baseQty > p.stock + 1e-9;
                  return (
                    <tr key={l.key}>
                      <td className="text-xs text-slate-400">{idx + 1}</td>
                      <td>
                        <SearchSelect
                          kind="products"
                          value={p ?? null}
                          onChange={(prod) => {
                            if (prod) remember(prod);
                            update(l.key, { productId: prod?.id ?? "", unitId: prod?.unitId ?? "", rate: prod ? String(baseRate(prod)) : "", batchNo: "", expiryDate: "", mfgDate: "" });
                          }}
                          placeholder={t("পণ্য খুঁজুন — নাম, কোড/SKU, বারকোড")}
                          disabled={lockedToInvoice}
                          create={lockedToInvoice ? false : { units }}
                          book={book}
                          currency={currency}
                          unitName={(id) => unitMap.get(id)?.name ?? ""}
                          priceOf={baseRate}
                          ariaLabel={`${t("পণ্য")}, ${t("সারি")} ${idx + 1}`}
                        />
                        {short && <p className="mt-1 text-xs text-credit">{t("মজুদ মাত্র")} {formatQty(p!.stock)} {unitMap.get(p!.unitId)?.name}</p>}
                        {l.maxQty !== undefined && <p className="mt-1 text-xs text-amber-700">{t("ফেরতযোগ্য সর্বোচ্চ")} {formatQty(l.maxQty)}</p>}
                        <FieldError name={`items.${idx}.productId`} />
                      </td>
                      <td>
                        <BatchCell product={p} inbound={!outgoing} batches={batches} warehouseId={warehouseId} batchNo={l.batchNo} expiryDate={l.expiryDate} mfgDate={l.mfgDate} fefo={kind === "SALES"} blockExpired={kind === "SALES" && !allowExpiredSale} onChange={(patch) => update(l.key, patch)} />
                      </td>
                      <td>
                        <select
                          className="input"
                          value={l.unitId}
                          disabled={!p}
                          onChange={(e) => {
                            const nu = unitMap.get(e.target.value);
                            const old = factorOf(l);
                            const nf = p && nu ? unitConversionFactor(nu, unitMap.get(p.unitId)!) ?? 1 : 1;
                            update(l.key, { unitId: e.target.value, rate: l.rate ? String(round2((Number(l.rate) / old) * nf)) : l.rate });
                          }}
                        >
                          {compatibleUnits(l.productId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.001" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label={t("পরিমাণ")} />
                        <FieldError name={`items.${idx}.quantity`} />
                      </td>
                      {showFree && (
                        <td>
                          <input className="input-num border-amber-300 bg-amber-50" type="text" inputMode="decimal" data-numeric min="0" step="0.001" value={l.freeQuantity} placeholder="0" onChange={(e) => update(l.key, { freeQuantity: e.target.value })} aria-label={t("ফ্রি পরিমাণ")} />
                          <FieldError name={`items.${idx}.freeQuantity`} />
                        </td>
                      )}
                      <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} aria-label={t("দর")} /></td>
                      <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.discount} placeholder="0" onChange={(e) => update(l.key, { discount: e.target.value })} aria-label={t("ছাড়")} /></td>
                      <td className="num font-semibold">{formatMoney(lineAmount({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.rate) || 0, discount: Number(l.discount) || 0 }), currency)}</td>
                      <td>{lines.length > 1 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label={t("সারি মুছুন")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!lockedToInvoice && (
            <div className="flex items-center justify-between border-t border-rule px-4 py-2.5">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: nextKey(), productId: "", unitId: "", quantity: "1", freeQuantity: "", rate: "", discount: "", batchNo: "", expiryDate: "", mfgDate: "" }])}>
                + {t("আরেকটি পণ্য")}
              </button>
              <FieldError name="items" />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel space-y-3 p-4 lg:col-span-3">
          {partyId ? (
            <PaymentRows rows={payments} setRows={setPayments} cashAccounts={cashAccounts} total={totals.total} currency={currency} label={t(payLabel)} book={book} />
          ) : (
            <PaymentRows rows={payments.length ? payments : []} setRows={setPayments} cashAccounts={cashAccounts} total={totals.total} currency={currency} label={`${t(payLabel)} — ${t("নগদ লেনদেনে সম্পূর্ণ টাকা")}`} book={book} />
          )}
          <FieldError name="payments" />
          <div>
            <label className="label" htmlFor="v-narr">{t("বিবরণ / নোট")}</label>
            <textarea id="v-narr" rows={2} className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
          </div>
        </section>

        <section className="panel p-4 lg:col-span-2">
          <dl className="space-y-2 text-sm">
            <Row label="উপমোট" value={formatMoney(totals.subtotal, currency)} />
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-600">{t("ছাড় (৳)")}</dt>
              <dd><input className="input-num w-32" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label={t("ছাড়")} /></dd>
            </div>
            {kind === "SALES" && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">{t("ভ্যাট %")} <span className="text-xs">({formatMoney(totals.vatAmount, currency)})</span></dt>
                <dd><input className="input-num w-32" type="text" inputMode="decimal" data-numeric min="0" max="100" step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} aria-label={t("ভ্যাট")} /></dd>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-double border-ink-600 pt-2 text-base font-bold text-ink-900">
              <dt>{t("সর্বমোট")}</dt>
              <dd className="tabular-nums">{formatMoney(totals.total, currency)}</dd>
            </div>
            <Row label="পরিশোধ" value={formatMoney(paid, currency)} />
            <Row label="বাকি" value={formatMoney(due, currency)} strong={due > 0} />
          </dl>
        </section>
      </div>

      <Footer cancelHref={cancelHref} label="ভাউচার সংরক্ষণ করুন" extra={<SubmitThenPrint label={kind === "SALES" ? "সংরক্ষণ ও ইনভয়েস প্রিন্ট" : "সংরক্ষণ ও প্রিন্ট"} />} />
    </ActionForm>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useT();
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-credit" : ""}`}>
      <dt className="text-slate-600">{t(label)}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

// ───────────────────────── receipt / payment / expense ─────────────────────────

export interface CashDefaults {
  date: string;
  /** no transaction:change_date permission: the date is fixed */
  dateLocked?: boolean;
  reference: string;
  narration: string;
  cashAccountId: string;
  lines: { accountId: string; amount: number; narration: string }[];
}

export function CashVoucherForm({
  kind,
  action,
  cashAccounts,
  accounts,
  defaults,
  currency,
  cancelHref,
  expenseMode,
  book,
}: {
  kind: "RECEIPT" | "PAYMENT";
  action: FormAction;
  cashAccounts: AccountOption[];
  accounts: AccountOption[];
  defaults: CashDefaults;
  currency: string;
  cancelHref: string;
  expenseMode?: boolean;
  /** "depot": depot-book ledgers (dealers, companies, depot cash) and balances */
  book?: "depot";
}) {
  const t = useT();
  const [date, setDate] = useState(defaults.date);
  const [reference, setReference] = useState(defaults.reference);
  const [narration, setNarration] = useState(defaults.narration);
  const [cashId, setCashId] = useState(defaults.cashAccountId || cashAccounts[0]?.id || "");
  const [lines, setLines] = useState(
    (defaults.lines.length ? defaults.lines : [{ accountId: "", amount: 0, narration: "" }]).map((l) => ({ key: nextKey(), accountId: l.accountId, amount: l.amount ? String(l.amount) : "", narration: l.narration })),
  );
  // accounts seen so far (sent by the page or picked from search) — for balances under the pickers
  const [accMap, setAccMap] = useState(() => new Map<string, AccountItem>([...cashAccounts, ...accounts].map((a) => [a.id, a])));
  const rememberAcc = (a: AccountItem | null) => a && setAccMap((m) => new Map(m).set(a.id, a));
  const total = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const update = (key: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = JSON.stringify({ date, reference, narration, cashAccountId: cashId, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, amount: Number(l.amount) || 0, narration: l.narration })) });
  const receipt = kind === "RECEIPT";
  const cash = accMap.get(cashId);

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="v-cash">{receipt ? t("জমা হবে (নগদ/ব্যাংক) — ডেবিট") : t("প্রদান হবে (নগদ/ব্যাংক) — ক্রেডিট")}</label>
          <SearchableAccountSelect id="v-cash" scope="cash" book={book} known={cashAccounts} value={cashId} onChange={(v, a) => { setCashId(v); rememberAcc(a); }} currency={currency} />
          {cash?.balance !== undefined && <p className="mt-1 text-xs text-slate-500">{t("বর্তমান ব্যালেন্স:")} {formatDrCr(cash.balance, currency)}</p>}
          <FieldError name="cashAccountId" />
        </div>
        <Header date={date} setDate={setDate} reference={reference} setReference={setReference} dateLocked={defaults.dateLocked} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">{expenseMode ? t("খরচের খাত (ডেবিট)") : receipt ? t("কার কাছ থেকে / কোন খাতে (ক্রেডিট)") : t("কাকে / কোন খাতে (ডেবিট)")}</h2></div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="min-w-64">{expenseMode ? t("খরচের খাত") : t("হিসাব (লেজার)")}</th><th className="w-40 text-right">{t("টাকা")}</th><th className="min-w-48">{t("লাইন বিবরণ")}</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, idx) => {
                const a = accMap.get(l.accountId);
                return (
                  <tr key={l.key}>
                    <td>
                      <SearchableAccountSelect scope={expenseMode ? "expense" : "all"} book={book} known={accounts} value={l.accountId} onChange={(v, acc) => { update(l.key, { accountId: v }); rememberAcc(acc); }} currency={currency} ariaLabel={`${t("হিসাব")}, ${t("লাইন")} ${idx + 1}`} />
                      {a?.balance !== undefined && !expenseMode && <p className="mt-1 text-xs text-slate-500">{t("ব্যালেন্স:")} {formatDrCr(a.balance, currency)}</p>}
                      <FieldError name={`lines.${idx}.accountId`} />
                    </td>
                    <td>
                      <input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} aria-label={t("টাকা")} />
                      <FieldError name={`lines.${idx}.amount`} />
                    </td>
                    <td><input className="input" value={l.narration} onChange={(e) => update(l.key, { narration: e.target.value })} aria-label={t("লাইন বিবরণ")} /></td>
                    <td>{lines.length > 1 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label={t("সারি মুছুন")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>{t("মোট")}</td><td className="num">{formatMoney(total, currency)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
        <div className="border-t border-rule px-4 py-2.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: nextKey(), accountId: "", amount: "", narration: "" }])}>+ {t("আরেকটি লাইন")}</button>
          <FieldError name="lines" />
        </div>
      </section>

      <section className="panel p-4">
        <label className="label" htmlFor="v-narr">{t("বিবরণ (ন্যারেশন)")}</label>
        <textarea id="v-narr" rows={2} className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
      </section>
      <Footer
        cancelHref={cancelHref}
        label={expenseMode ? "খরচ সংরক্ষণ করুন" : receipt ? "রিসিপ্ট সংরক্ষণ করুন" : "পেমেন্ট সংরক্ষণ করুন"}
        extra={<SubmitThenPrint />}
      />
    </ActionForm>
  );
}

/** Second submit button: save, then open the printable receipt / voucher. */
export function SubmitThenPrint({ label = "সংরক্ষণ ও প্রিন্ট" }: { label?: string }) {
  const { pending } = useFormCtx();
  const t = useT();
  return (
    <button type="submit" name="then" value="print" className="btn-secondary" disabled={pending}>
      {t(label)}
    </button>
  );
}

// ───────────────────────── journal ─────────────────────────

export interface JournalDefaults {
  date: string;
  /** no transaction:change_date permission: the date is fixed */
  dateLocked?: boolean;
  reference: string;
  narration: string;
  lines: { accountId: string; debit: number; credit: number; narration: string }[];
}

export function JournalVoucherForm({ action, accounts, defaults, currency, cancelHref }: { action: FormAction; accounts: AccountOption[]; defaults: JournalDefaults; currency: string; cancelHref: string }) {
  const t = useT();
  const [date, setDate] = useState(defaults.date);
  const [reference, setReference] = useState(defaults.reference);
  const [narration, setNarration] = useState(defaults.narration);
  const blank = () => ({ key: nextKey(), accountId: "", debit: "", credit: "", narration: "" });
  const [lines, setLines] = useState(
    defaults.lines.length
      ? defaults.lines.map((l) => ({ key: nextKey(), accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", narration: l.narration }))
      : [blank(), blank()],
  );
  const dr = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const cr = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const diff = round2(dr - cr);
  const update = (key: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = JSON.stringify({ date, reference, narration, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, narration: l.narration })) });

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"><Header date={date} setDate={setDate} reference={reference} setReference={setReference} dateLocked={defaults.dateLocked} /></section>
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">{t("জার্নাল এন্ট্রি")}</h2></div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="min-w-64">{t("হিসাব (লেজার)")}</th><th className="w-36 text-right">{t("ডেবিট")}</th><th className="w-36 text-right">{t("ক্রেডিট")}</th><th className="min-w-44">{t("লাইন বিবরণ")}</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={l.key}>
                  <td><SearchableAccountSelect scope="all" known={accounts} value={l.accountId} onChange={(v) => update(l.key, { accountId: v })} currency={currency} ariaLabel={`${t("হিসাব")}, ${t("সারি")} ${idx + 1}`} /><FieldError name={`lines.${idx}.accountId`} /></td>
                  <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.debit} onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} aria-label={t("ডেবিট")} /><FieldError name={`lines.${idx}.debit`} /></td>
                  <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.credit} onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} aria-label={t("ক্রেডিট")} /></td>
                  <td><input className="input" value={l.narration} onChange={(e) => update(l.key, { narration: e.target.value })} aria-label={t("লাইন বিবরণ")} /></td>
                  <td>{lines.length > 2 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label={t("সারি মুছুন")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t("মোট")}</td>
                <td className="num dr">{formatMoney(dr, currency)}</td>
                <td className="num cr">{formatMoney(cr, currency)}</td>
                <td colSpan={2} className={diff === 0 ? "text-brand-700" : "text-credit"}>
                  {diff === 0 ? (dr > 0 ? `✔ ${t("ডেবিট = ক্রেডিট")}` : "") : `✘ ${t("পার্থক্য")} ${formatMoney(Math.abs(diff), currency)} (${diff > 0 ? t("ক্রেডিট কম") : t("ডেবিট কম")})`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-rule px-4 py-2.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}>+ {t("আরেকটি লাইন")}</button>
          <FieldError name="lines" />
        </div>
      </section>
      <section className="panel p-4">
        <label className="label" htmlFor="v-narr">{t("বিবরণ (ন্যারেশন)")}</label>
        <textarea id="v-narr" rows={2} className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
      </section>
      <Footer cancelHref={cancelHref} label="জার্নাল সংরক্ষণ করুন" disabled={diff !== 0 || dr === 0} />
    </ActionForm>
  );
}

// ───────────────────────── stock journal ─────────────────────────

export interface StockJournalDefaults {
  date: string;
  /** no transaction:change_date permission: the date is fixed */
  dateLocked?: boolean;
  reference: string;
  narration: string;
  lines: { productId: string; warehouseId: string; direction: 1 | -1; quantity: number; rate: number | null; batchNo: string; expiryDate: string; mfgDate?: string }[];
}

export function StockJournalForm({
  action,
  products,
  units,
  warehouses,
  batches,
  defaults,
  currency,
  cancelHref,
  book,
}: {
  action: FormAction;
  products: ProductOption[];
  units: UnitOption[];
  warehouses: WarehouseOption[];
  batches: BatchOption[];
  defaults: StockJournalDefaults;
  /** "depot": a depot stock adjustment — depot products only */
  book?: "depot";
  currency: string;
  cancelHref: string;
}) {
  const t = useT();
  const [date, setDate] = useState(defaults.date);
  const [reference, setReference] = useState(defaults.reference);
  const [narration, setNarration] = useState(defaults.narration);
  const [productMap, setProductMap] = useState(() => new Map(products.map((p) => [p.id, p])));
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "";
  const blank = () => ({ key: nextKey(), productId: "", warehouseId: warehouses[0]?.id ?? "", direction: "-1", quantity: "", rate: "", batchNo: "", expiryDate: "", mfgDate: "" });
  const [lines, setLines] = useState(
    defaults.lines.length
      ? defaults.lines.map((l) => ({ key: nextKey(), productId: l.productId, warehouseId: l.warehouseId, direction: String(l.direction), quantity: String(l.quantity), rate: l.rate !== null ? String(l.rate) : "", batchNo: l.batchNo, expiryDate: l.expiryDate, mfgDate: l.mfgDate ?? "" }))
      : [blank()],
  );
  const update = (key: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const value = (l: (typeof lines)[number]) => {
    const p = productMap.get(l.productId);
    const rate = l.direction === "1" && l.rate !== "" ? Number(l.rate) : p ? p.avgCost || p.purchasePrice : 0;
    return round2((Number(l.quantity) || 0) * rate);
  };
  const vin = round2(lines.filter((l) => l.direction === "1").reduce((s, l) => s + value(l), 0));
  const vout = round2(lines.filter((l) => l.direction === "-1").reduce((s, l) => s + value(l), 0));
  const payload = JSON.stringify({
    date, reference, narration,
    lines: lines.filter((l) => l.productId).map((l) => ({
      productId: l.productId, warehouseId: l.warehouseId, direction: Number(l.direction), quantity: Number(l.quantity) || 0,
      rate: l.direction === "1" && l.rate !== "" ? Number(l.rate) : null, batchNo: l.batchNo || null, expiryDate: l.expiryDate || null, mfgDate: l.mfgDate || null,
    })),
  });

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"><Header date={date} setDate={setDate} reference={reference} setReference={setReference} dateLocked={defaults.dateLocked} /></section>
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">{t("স্টক সমন্বয় / স্থানান্তর")}</h2><span className="text-xs text-slate-500">{t("স্থানান্তর: এক গুদাম থেকে “বাহির” ও অন্য গুদামে “আগমন” লাইন দিন")}</span></div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="min-w-56">{t("পণ্য")}</th><th className="w-40">{t("গুদাম")}</th><th className="w-36">{t("দিক")}</th><th className="w-40">{t("ব্যাচ")}</th><th className="w-28 text-right">{t("পরিমাণ")}</th><th className="w-32 text-right">{t("দর (আগমন)")}</th><th className="w-32 text-right">{t("মূল্য")}</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, idx) => {
                const p = productMap.get(l.productId);
                return (
                  <tr key={l.key}>
                    <td>
                      <SearchSelect
                        kind="products"
                        value={productMap.get(l.productId) ?? null}
                        onChange={(prod) => {
                          if (prod) setProductMap((m) => new Map(m).set(prod.id, prod));
                          update(l.key, { productId: prod?.id ?? "", batchNo: "", expiryDate: "", mfgDate: "" });
                        }}
                        placeholder={t("পণ্য খুঁজুন — নাম, কোড/SKU, বারকোড")}
                        create={{ units }}
                        book={book}
                        currency={currency}
                        unitName={unitName}
                        priceOf={(x) => x.avgCost || x.purchasePrice}
                        ariaLabel={`${t("পণ্য")}, ${t("সারি")} ${idx + 1}`}
                      />
                      <FieldError name={`lines.${idx}.productId`} />
                    </td>
                    <td>
                      <select className="input" value={l.warehouseId} onChange={(e) => update(l.key, { warehouseId: e.target.value })} aria-label={t("গুদাম")}>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={l.direction} onChange={(e) => update(l.key, { direction: e.target.value })} aria-label={t("দিক")}>
                        <option value="-1">{t("বাহির (ঘাটতি/নষ্ট)")}</option>
                        <option value="1">{t("আগমন (উদ্বৃত্ত)")}</option>
                      </select>
                    </td>
                    <td><BatchCell product={p} inbound={l.direction === "1"} batches={batches} warehouseId={l.warehouseId} batchNo={l.batchNo} expiryDate={l.expiryDate} mfgDate={l.mfgDate} onChange={(patch) => update(l.key, patch)} /></td>
                    <td>
                      <input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.001" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label={t("পরিমাণ")} />
                      {p && <span className="text-[11px] text-slate-400">{unitName(p.unitId)}</span>}
                      <FieldError name={`lines.${idx}.quantity`} />
                    </td>
                    <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.rate} placeholder={p ? String(p.avgCost || p.purchasePrice) : ""} disabled={l.direction !== "1"} onChange={(e) => update(l.key, { rate: e.target.value })} aria-label={t("দর")} /></td>
                    <td className="num">{formatMoney(value(l), currency)}</td>
                    <td>{lines.length > 1 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label={t("সারি মুছুন")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={6}>{t("আগমন")} {formatMoney(vin, currency)} · {t("বাহির")} {formatMoney(vout, currency)} · {t("নিট সমন্বয়")}</td><td className="num">{formatMoney(vin - vout, currency)}</td><td /></tr></tfoot>
          </table>
        </div>
        <div className="border-t border-rule px-4 py-2.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}>+ {t("আরেকটি লাইন")}</button>
          <FieldError name="lines" />
        </div>
      </section>
      <section className="panel p-4">
        <label className="label" htmlFor="v-narr">{t("কারণ / বিবরণ")}</label>
        <textarea id="v-narr" rows={2} className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
      </section>
      <Footer cancelHref={cancelHref} label="স্টক জার্নাল সংরক্ষণ করুন" />
    </ActionForm>
  );
}
