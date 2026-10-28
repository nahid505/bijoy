"use client";

import { SearchSelect } from "./search-select";
import { useEffect, useMemo, useRef, useState } from "react";
import { unitConversionFactor } from "@/lib/accounting";
import { computeTotals, lineAmount, round2 } from "@/lib/calc";
import { formatMoney, formatQty } from "@/lib/format";
import { ActionForm, FieldError, useFormCtx, type FormAction } from "./forms";
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

interface CartLine {
  key: number;
  productId: string;
  unitId: string;
  quantity: number;
  rate: number;
  discount: number;
  batchNo: string;
}

/** Fast point-of-sale screen. Posts the same SALES voucher payload as the full form. */
export function PosScreen({
  action,
  customers,
  cashAccounts,
  products,
  units,
  warehouses,
  batches,
  defaultVat,
  currency,
  today,
  allowExpiredSale = false,
}: {
  action: FormAction;
  customers: PartyOption[];
  cashAccounts: AccountOption[];
  products: ProductOption[];
  units: UnitOption[];
  warehouses: WarehouseOption[];
  batches: BatchOption[];
  defaultVat: number;
  currency: string;
  today: string;
  allowExpiredSale?: boolean;
}) {
  const t = useT();
  const searchRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<PartyOption | null>(() => customers[0] ?? null);
  const customerId = customer?.id ?? "";
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [priceMode, setPriceMode] = useState<"retail" | "wholesale">("retail");
  const [discount, setDiscount] = useState("");
  const [vat, setVat] = useState(String(defaultVat));
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  const [tendered, setTendered] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? products.filter((p) => `${p.name} ${p.code ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(s)) : products;
    return list.slice(0, 18);
  }, [q, products]);

  const priceOf = (p: ProductOption) => (priceMode === "wholesale" && p.wholesalePrice ? p.wholesalePrice : p.salePrice);
  const factorOf = (l: CartLine) => {
    const p = productMap.get(l.productId)!;
    const u = unitMap.get(l.unitId);
    return u ? unitConversionFactor(u, unitMap.get(p.unitId)!) ?? 1 : 1;
  };

  function add(p: ProductOption) {
    setCart((c) => {
      const hit = c.find((l) => l.productId === p.id && l.unitId === p.unitId && (!p.trackBatch || l.batchNo === ""));
      if (hit) return c.map((l) => (l === hit ? { ...l, quantity: l.quantity + 1 } : l));
      // batch-tracked products default to automatic FEFO (earliest unexpired batch, chosen on the server)
      return [...c, { key: nextKey(), productId: p.id, unitId: p.unitId, quantity: 1, rate: priceOf(p), discount: 0, batchNo: "" }];
    });
    setQ("");
    searchRef.current?.focus();
  }
  const update = (key: number, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totals = computeTotals(cart.map((l) => ({ quantity: l.quantity, unitPrice: l.rate, discount: l.discount })), Number(discount) || 0, Number(vat) || 0);

  // Walk-in sales are cash by default: keep the single cash payment in sync with the total until the user edits payments.
  useEffect(() => {
    if (!paymentsTouched && !customerId) {
      setPayments(totals.total > 0 ? [{ key: 1, accountId: cashAccounts[0]?.id ?? "", amount: String(totals.total), reference: "" }] : []);
    }
    if (!paymentsTouched && customerId) setPayments([]);
  }, [totals.total, customerId, paymentsTouched, cashAccounts]);

  const pay = paymentsPayload(payments);
  const paid = round2(pay.reduce((s, p) => s + p.amount, 0));
  const due = round2(totals.total - paid);
  const cashPaid = round2(pay.filter((p) => p.accountId === cashAccounts[0]?.id).reduce((s, p) => s + p.amount, 0));
  const change = tendered ? round2(Number(tendered) - cashPaid) : 0;
  const projectedDue = customer ? round2((customer.balance ?? 0) + due) : undefined;

  // Keyboard: F2 = search, F9 = save & print
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "F9") {
        e.preventDefault();
        formRef.current?.querySelector<HTMLButtonElement>("button[value=print]")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const payload = JSON.stringify({
    date: today, reference: null, narration: note, partyAccountId: customerId || null, warehouseId, returnOfId: null, dueDate: customerId && dueDate ? dueDate : null,
    discount: Number(discount) || 0, vatPercent: Number(vat) || 0, payments: pay,
    items: cart.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, rate: l.rate, discount: l.discount, batchNo: l.batchNo || null, expiryDate: null })),
  });

  return (
    <div ref={formRef}>
      <ActionForm action={action} className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <input type="hidden" name="payload" value={payload} />
        {/* ── left: product search + cart */}
        <div className="space-y-4">
          <section className="panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={searchRef}
                autoFocus
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
                  if (pick) add(pick);
                }}
                aria-label={t("পণ্য খুঁজুন")}
              />
              <select className="input w-auto" value={priceMode} onChange={(e) => setPriceMode(e.target.value as "retail" | "wholesale")} aria-label={t("মূল্য ধরন")}>
                <option value="retail">{t("খুচরা")}</option>
                <option value="wholesale">{t("পাইকারি")}</option>
              </select>
              {warehouses.length > 1 && (
                <select className="input w-auto" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={t("গুদাম")}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => add(p)}
                  disabled={p.stock <= 0}
                  className="rounded-md border border-rule bg-white p-2 text-left transition hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <p className="line-clamp-2 text-xs font-semibold text-ink-900">{p.name}</p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-brand-700">{formatMoney(priceOf(p), currency)}</p>
                  <p className={`text-[10px] ${p.stock <= 0 ? "text-credit" : "text-slate-500"}`}>{t("মজুদ")} {formatQty(p.stock)} {unitMap.get(p.unitId)?.name}</p>
                </button>
              ))}
              {results.length === 0 && <p className="col-span-full py-4 text-center text-sm text-slate-400">{t("কোনো পণ্য পাওয়া যায়নি")}</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">{t("কার্ট")} ({formatQty(cart.length)})</h2>{cart.length > 0 && <button type="button" className="btn-ghost btn-sm text-credit" onClick={() => setCart([])}>{t("সব মুছুন")}</button>}</div>
            {cart.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">{t("পণ্য খুঁজে বা বারকোড স্ক্যান করে কার্টে যোগ করুন")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th className="min-w-44">{t("পণ্য")}</th><th className="w-36">{t("ব্যাচ")}</th><th className="w-28">{t("ইউনিট")}</th><th className="w-36 text-center">{t("পরিমাণ")}</th><th className="w-28 text-right">{t("দর")}</th><th className="w-24 text-right">{t("ছাড়")}</th><th className="w-32 text-right">{t("মোট")}</th><th className="w-8" /></tr></thead>
                  <tbody>
                    {cart.map((l, idx) => {
                      const p = productMap.get(l.productId)!;
                      const short = l.quantity * factorOf(l) > p.stock + 1e-9;
                      return (
                        <tr key={l.key}>
                          <td>
                            <p className="font-medium">{p.name}</p>
                            {short && <p className="text-xs text-credit">{t("মজুদ মাত্র")} {formatQty(p.stock)}</p>}
                            <FieldError name={`items.${idx}.quantity`} />
                          </td>
                          <td><BatchCell product={p} inbound={false} batches={batches} warehouseId={warehouseId} batchNo={l.batchNo} expiryDate="" fefo blockExpired={!allowExpiredSale} onChange={(x) => update(l.key, { batchNo: x.batchNo ?? l.batchNo })} /></td>
                          <td>
                            <select className="input" value={l.unitId} onChange={(e) => {
                              const nu = unitMap.get(e.target.value)!;
                              const nf = unitConversionFactor(nu, unitMap.get(p.unitId)!) ?? 1;
                              update(l.key, { unitId: e.target.value, rate: round2((l.rate / factorOf(l)) * nf) });
                            }} aria-label={t("ইউনিট")}>
                              {units.filter((u) => unitConversionFactor(u, unitMap.get(p.unitId)!) !== null).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </td>
                          <td>
                            <div className="flex items-center justify-center gap-1">
                              <button type="button" className="btn-secondary btn-sm" aria-label={t("কমান")} onClick={() => update(l.key, { quantity: Math.max(round2(l.quantity - 1), 0.001) })}>−</button>
                              <input className="input-num w-16" type="text" inputMode="decimal" data-numeric min="0" step="0.001" value={l.quantity} onChange={(e) => update(l.key, { quantity: Number(e.target.value) || 0 })} aria-label={t("পরিমাণ")} />
                              <button type="button" className="btn-secondary btn-sm" aria-label={t("বাড়ান")} onClick={() => update(l.key, { quantity: round2(l.quantity + 1) })}>+</button>
                            </div>
                          </td>
                          <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.rate} onChange={(e) => update(l.key, { rate: Number(e.target.value) || 0 })} aria-label={t("দর")} /></td>
                          <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={l.discount || ""} placeholder="0" onChange={(e) => update(l.key, { discount: Number(e.target.value) || 0 })} aria-label={t("ছাড়")} /></td>
                          <td className="num font-semibold">{formatMoney(lineAmount({ quantity: l.quantity, unitPrice: l.rate, discount: l.discount }), currency)}</td>
                          <td><button type="button" className="btn-ghost btn-sm text-credit" aria-label={t("সারি মুছুন")} onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 pb-2"><FieldError name="items" /></div>
          </section>
        </div>

        {/* ── right: customer, totals, payment */}
        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className="panel p-4">
            <label className="label" htmlFor="pos-customer">{t("কাস্টমার")}</label>
            <SearchSelect kind="customers" id="pos-customer" value={customer} onChange={(c) => { setCustomer(c); setPaymentsTouched(false); }} noneLabel={t("নগদ কাস্টমার (ওয়াক-ইন)")} create={{}} currency={currency} ariaLabel={t("কাস্টমার")} />
            <PartyInfo party={customer ?? undefined} currency={currency} projectedDue={projectedDue} />
            {customerId && (
              <div className="mt-2">
                <label className="label" htmlFor="pos-due">{t("বাকি পরিশোধের তারিখ")}</label>
                <input id="pos-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            )}
          </section>

          <section className="panel p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">{t("উপমোট")}</dt><dd className="tabular-nums">{formatMoney(totals.subtotal, currency)}</dd></div>
              <div className="flex items-center justify-between gap-2"><dt className="text-slate-600">{t("ছাড় (৳)")}</dt><dd><input className="input-num w-28" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={discount} placeholder="0" onChange={(e) => setDiscount(e.target.value)} aria-label={t("ছাড়")} /></dd></div>
              <div className="flex items-center justify-between gap-2"><dt className="text-slate-600">{t("ভ্যাট %")} ({formatMoney(totals.vatAmount, currency)})</dt><dd><input className="input-num w-28" type="text" inputMode="decimal" data-numeric min="0" max="100" step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} aria-label={t("ভ্যাট")} /></dd></div>
              <div className="flex items-end justify-between border-t-2 border-double border-ink-600 pt-2">
                <dt className="font-bold text-ink-900">{t("সর্বমোট")}</dt>
                <dd className="text-2xl font-bold tabular-nums text-ink-900">{formatMoney(totals.total, currency)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel space-y-3 p-4">
            <PaymentRows rows={payments} setRows={(r) => { setPaymentsTouched(true); setPayments(r); }} cashAccounts={cashAccounts} total={totals.total} currency={currency} label={t("পেমেন্ট (একাধিক মাধ্যম)")} />
            <FieldError name="payments" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="pos-tender">{t("নগদ গ্রহণ")}</label>
                <input id="pos-tender" className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="1" value={tendered} placeholder={String(cashPaid || "")} onChange={(e) => setTendered(e.target.value)} />
              </div>
              <div className="rounded-md bg-ink-50 px-3 py-1.5">
                <p className="text-[11px] text-slate-500">{t("ফেরত দিন")}</p>
                <p className={`text-lg font-bold tabular-nums ${change < 0 ? "text-credit" : "text-brand-700"}`}>{formatMoney(Math.max(change, 0), currency)}</p>
              </div>
            </div>
            <div className={`flex justify-between rounded-md px-3 py-2 text-sm font-semibold ${due > 0 ? "bg-red-50 text-credit" : "bg-brand-50 text-brand-800"}`}>
              <span>{due > 0 ? (customerId ? t("বাকি (কাস্টমারের হিসাবে)") : t("পরিশোধ বাকি — নগদ কাস্টমারে বাকি হয় না")) : t("সম্পূর্ণ পরিশোধিত")}</span>
              <span className="tabular-nums">{formatMoney(Math.max(due, 0), currency)}</span>
            </div>
            <input className="input" placeholder={t("নোট (ঐচ্ছিক)")} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("নোট")} />
          </section>

          <PosButtons disabled={cart.length === 0} />
        </aside>
      </ActionForm>
    </div>
  );
}

function PosButtons({ disabled }: { disabled: boolean }) {
  const { pending } = useFormCtx();
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="submit" name="then" value="print" className="btn-primary py-3 text-base" disabled={disabled || pending}>
        {pending ? t("সংরক্ষণ হচ্ছে…") : t("🧾 সংরক্ষণ ও প্রিন্ট (F9)")}
      </button>
      <button type="submit" name="then" value="pos" className="btn-secondary py-3 text-base" disabled={disabled || pending}>
        {t("সংরক্ষণ ও নতুন বিক্রয়")}
      </button>
    </div>
  );
}
