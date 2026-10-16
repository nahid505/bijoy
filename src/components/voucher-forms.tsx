"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { unitConversionFactor } from "@/lib/accounting";
import { computeTotals, lineAmount, round2 } from "@/lib/calc";
import { formatDrCr, formatMoney, formatQty } from "@/lib/format";
import { SearchSelect } from "./search-select";
import { EntryDateInput } from "./entry-date-input";
import { ActionForm, FieldError, SubmitButton, useFormCtx, type FormAction } from "./forms";
import { SearchableAccountSelect, type AccountItem } from "./account-select";
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
  return (
    <>
      <div>
        <label className="label" htmlFor="v-date">তারিখ *</label>
        <EntryDateInput id="v-date" value={date} onChange={setDate} locked={dateLocked} />
        <FieldError name="date" />
      </div>
      <div>
        <label className="label" htmlFor="v-ref">রেফারেন্স</label>
        <input id="v-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="চালান/চেক/মেমো নং" />
      </div>
    </>
  );
}

function Footer({ cancelHref, label, disabled, extra }: { cancelHref: string; label: string; disabled?: boolean; extra?: React.ReactNode }) {
  const { pending } = useFormCtx();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {disabled ? <button type="button" className="btn-primary" disabled>{label}</button> : <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">{label}</SubmitButton>}
      {extra}
      <Link prefetch={false} href={cancelHref} className={`btn-secondary ${pending ? "pointer-events-none opacity-60" : ""}`}>বাতিল</Link>
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
  items: { productId: string; unitId: string; quantity: number; rate: number; discount: number; batchNo: string; expiryDate: string; mfgDate?: string; maxQty?: number }[];
}

interface TradeLine {
  key: number;
  productId: string;
  unitId: string;
  quantity: string;
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
  units,
  batches,
  defaults,
  currency,
  cancelHref,
  allowExpiredSale = false,
}: {
  kind: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";
  action: FormAction;
  parties: PartyOption[];
  cashAccounts: AccountOption[];
  warehouses: WarehouseOption[];
  products: ProductOption[];
  units: UnitOption[];
  batches: BatchOption[];
  defaults: TradeDefaults;
  currency: string;
  cancelHref: string;
  allowExpiredSale?: boolean;
}) {
  const isSale = kind === "SALES" || kind === "SALES_RETURN";
  const outgoing = kind === "SALES" || kind === "PURCHASE_RETURN";
  // products known on the client: those already on the voucher + every product picked since
  const [productMap, setProductMap] = useState(() => new Map(products.map((p) => [p.id, p])));
  const remember = (p: ProductOption) => setProductMap((m) => new Map(m).set(p.id, p));
  const unitMap = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const lockedToInvoice = !!defaults.returnOfId;

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
      ? defaults.items.map((i) => ({ key: nextKey(), productId: i.productId, unitId: i.unitId, quantity: String(i.quantity), rate: String(i.rate), discount: i.discount ? String(i.discount) : "", batchNo: i.batchNo, expiryDate: i.expiryDate, mfgDate: i.mfgDate ?? "", maxQty: i.maxQty }))
      : [{ key: nextKey(), productId: "", unitId: "", quantity: "1", rate: "", discount: "", batchNo: "", expiryDate: "", mfgDate: "" }],
  );

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
      productId: l.productId, unitId: l.unitId || null, quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0, discount: Number(l.discount) || 0,
      batchNo: l.batchNo || null, expiryDate: l.expiryDate || null, mfgDate: l.mfgDate || null,
    })),
  });
  const payLabel = kind === "SALES" ? "আদায় (নগদ/ব্যাংক/মোবাইল)" : kind === "PURCHASE" ? "পরিশোধ (নগদ/ব্যাংক/মোবাইল)" : kind === "SALES_RETURN" ? "ফেরত প্রদান" : "ফেরত প্রাপ্তি";

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      {lockedToInvoice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          মূল ইনভয়েস <b>{defaults.returnOfNo}</b> এর বিপরীতে ফেরত — সর্বোচ্চ বিক্রিত/ক্রয়কৃত অবশিষ্ট পরিমাণ পর্যন্ত। স্টক ও হিসাব স্বয়ংক্রিয়ভাবে উল্টানো হবে।
        </div>
      )}

      <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="v-party">{isSale ? "কাস্টমার" : "সরবরাহকারী"}</label>
          <SearchSelect
            kind={isSale ? "customers" : "suppliers"}
            id="v-party"
            value={party}
            onChange={setParty}
            noneLabel={isSale ? "নগদ কাস্টমার (ওয়াক-ইন)" : "নগদ ক্রয় (সরবরাহকারী ছাড়া)"}
            disabled={lockedToInvoice}
            create={lockedToInvoice ? false : {}}
            currency={currency}
            ariaLabel={isSale ? "কাস্টমার" : "সরবরাহকারী"}
          />
          <PartyInfo party={party ?? undefined} currency={currency} projectedDue={projectedDue} />
          <FieldError name="partyAccountId" />
        </div>
        <Header date={date} setDate={setDate} reference={reference} setReference={setReference} dateLocked={defaults.dateLocked} />
        <div>
          <label className="label" htmlFor="v-wh">গুদাম</label>
          <select id="v-wh" className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        {(kind === "SALES" || kind === "PURCHASE") && (
          <div>
            <label className="label" htmlFor="v-due">পরিশোধের শেষ তারিখ</label>
            <input id="v-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} title="ফাঁকা থাকলে পার্টির ক্রেডিট দিন অনুযায়ী" />
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head flex-wrap">
          <h2 className="panel-title">পণ্য</h2>
          <div className="flex flex-wrap items-center gap-2">
            {kind === "SALES" && (
              <select className="input w-auto py-1 text-xs" value={priceMode} onChange={(e) => setPriceMode(e.target.value as "retail" | "wholesale")} aria-label="মূল্য ধরন">
                <option value="retail">খুচরা মূল্য</option>
                <option value="wholesale">পাইকারি মূল্য</option>
              </select>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th className="min-w-56">পণ্য</th>
                <th className="w-40">ব্যাচ / মেয়াদ</th>
                <th className="w-32">ইউনিট</th>
                <th className="w-28 text-right">পরিমাণ</th>
                <th className="w-32 text-right">দর</th>
                <th className="w-28 text-right">ছাড়</th>
                <th className="w-36 text-right">মোট</th>
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
                        placeholder="পণ্য খুঁজুন — নাম, কোড/SKU, বারকোড"
                        disabled={lockedToInvoice}
                        create={lockedToInvoice ? false : { units }}
                        currency={currency}
                        unitName={(id) => unitMap.get(id)?.name ?? ""}
                        priceOf={baseRate}
                        ariaLabel={`পণ্য, সারি ${idx + 1}`}
                      />
                      {short && <p className="mt-1 text-xs text-credit">মজুদ মাত্র {formatQty(p!.stock)} {unitMap.get(p!.unitId)?.name}</p>}
                      {l.maxQty !== undefined && <p className="mt-1 text-xs text-amber-700">ফেরতযোগ্য সর্বোচ্চ {formatQty(l.maxQty)}</p>}
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
                      <input className="input-num" type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label="পরিমাণ" />
                      <FieldError name={`items.${idx}.quantity`} />
                    </td>
                    <td><input className="input-num" type="number" min="0" step="0.01" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} aria-label="দর" /></td>
                    <td><input className="input-num" type="number" min="0" step="0.01" value={l.discount} placeholder="0" onChange={(e) => update(l.key, { discount: e.target.value })} aria-label="ছাড়" /></td>
                    <td className="num font-semibold">{formatMoney(lineAmount({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.rate) || 0, discount: Number(l.discount) || 0 }), currency)}</td>
                    <td>{lines.length > 1 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label="সারি মুছুন" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!lockedToInvoice && (
          <div className="flex items-center justify-between border-t border-rule px-4 py-2.5">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: nextKey(), productId: "", unitId: "", quantity: "1", rate: "", discount: "", batchNo: "", expiryDate: "", mfgDate: "" }])}>
              + আরেকটি পণ্য
            </button>
            <FieldError name="items" />
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel space-y-3 p-4 lg:col-span-3">
          {partyId ? (
            <PaymentRows rows={payments} setRows={setPayments} cashAccounts={cashAccounts} total={totals.total} currency={currency} label={payLabel} />
          ) : (
            <PaymentRows rows={payments.length ? payments : []} setRows={setPayments} cashAccounts={cashAccounts} total={totals.total} currency={currency} label={`${payLabel} — নগদ লেনদেনে সম্পূর্ণ টাকা`} />
          )}
          <FieldError name="payments" />
          <div>
            <label className="label" htmlFor="v-narr">বিবরণ / নোট</label>
            <textarea id="v-narr" rows={2} className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
          </div>
        </section>

        <section className="panel p-4 lg:col-span-2">
          <dl className="space-y-2 text-sm">
            <Row label="উপমোট" value={formatMoney(totals.subtotal, currency)} />
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-600">ছাড় (৳)</dt>
              <dd><input className="input-num w-32" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label="ছাড়" /></dd>
            </div>
            {kind === "SALES" && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">ভ্যাট % <span className="text-xs">({formatMoney(totals.vatAmount, currency)})</span></dt>
                <dd><input className="input-num w-32" type="number" min="0" max="100" step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} aria-label="ভ্যাট" /></dd>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-double border-ink-600 pt-2 text-base font-bold text-ink-900">
              <dt>সর্বমোট</dt>
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
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-credit" : ""}`}>
      <dt className="text-slate-600">{label}</dt>
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
}: {
  kind: "RECEIPT" | "PAYMENT";
  action: FormAction;
  cashAccounts: AccountOption[];
  accounts: AccountOption[];
  defaults: CashDefaults;
  currency: string;
  cancelHref: string;
  expenseMode?: boolean;
}) {
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
          <label className="label" htmlFor="v-cash">{receipt ? "জমা হবে (নগদ/ব্যাংক) — ডেবিট" : "প্রদান হবে (নগদ/ব্যাংক) — ক্রেডিট"}</label>
          <SearchableAccountSelect id="v-cash" scope="cash" known={cashAccounts} value={cashId} onChange={(v, a) => { setCashId(v); rememberAcc(a); }} currency={currency} />
          {cash?.balance !== undefined && <p className="mt-1 text-xs text-slate-500">বর্তমান ব্যালেন্স: {formatDrCr(cash.balance, currency)}</p>}
          <FieldError name="cashAccountId" />
        </div>
        <Header date={date} setDate={setDate} reference={reference} setReference={setReference} dateLocked={defaults.dateLocked} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">{expenseMode ? "খরচের খাত (ডেবিট)" : receipt ? "কার কাছ থেকে / কোন খাতে (ক্রেডিট)" : "কাকে / কোন খাতে (ডেবিট)"}</h2></div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="min-w-64">{expenseMode ? "খরচের খাত" : "হিসাব (লেজার)"}</th><th className="w-40 text-right">টাকা</th><th className="min-w-48">লাইন বিবরণ</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, idx) => {
                const a = accMap.get(l.accountId);
                return (
                  <tr key={l.key}>
                    <td>
                      <SearchableAccountSelect scope={expenseMode ? "expense" : "all"} known={accounts} value={l.accountId} onChange={(v, acc) => { update(l.key, { accountId: v }); rememberAcc(acc); }} currency={currency} ariaLabel={`হিসাব, লাইন ${idx + 1}`} />
                      {a?.balance !== undefined && !expenseMode && <p className="mt-1 text-xs text-slate-500">ব্যালেন্স: {formatDrCr(a.balance, currency)}</p>}
                      <FieldError name={`lines.${idx}.accountId`} />
                    </td>
                    <td>
                      <input className="input-num" type="number" min="0" step="0.01" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} aria-label="টাকা" />
                      <FieldError name={`lines.${idx}.amount`} />
                    </td>
                    <td><input className="input" value={l.narration} onChange={(e) => update(l.key, { narration: e.target.value })} aria-label="লাইন বিবরণ" /></td>
                    <td>{lines.length > 1 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label="সারি মুছুন" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>মোট</td><td className="num">{formatMoney(total, currency)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
        <div className="border-t border-rule px-4 py-2.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: nextKey(), accountId: "", amount: "", narration: "" }])}>+ আরেকটি লাইন</button>
          <FieldError name="lines" />
        </div>
      </section>

      <section className="panel p-4">
        <label className="label" htmlFor="v-narr">বিবরণ (ন্যারেশন)</label>
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
  return (
    <button type="submit" name="then" value="print" className="btn-secondary" disabled={pending}>
      {label}
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
        <div className="panel-head"><h2 className="panel-title">জার্নাল এন্ট্রি</h2></div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="min-w-64">হিসাব (লেজার)</th><th className="w-36 text-right">ডেবিট</th><th className="w-36 text-right">ক্রেডিট</th><th className="min-w-44">লাইন বিবরণ</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={l.key}>
                  <td><SearchableAccountSelect scope="all" known={accounts} value={l.accountId} onChange={(v) => update(l.key, { accountId: v })} currency={currency} ariaLabel={`হিসাব, সারি ${idx + 1}`} /><FieldError name={`lines.${idx}.accountId`} /></td>
                  <td><input className="input-num" type="number" min="0" step="0.01" value={l.debit} onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} aria-label="ডেবিট" /><FieldError name={`lines.${idx}.debit`} /></td>
                  <td><input className="input-num" type="number" min="0" step="0.01" value={l.credit} onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} aria-label="ক্রেডিট" /></td>
                  <td><input className="input" value={l.narration} onChange={(e) => update(l.key, { narration: e.target.value })} aria-label="লাইন বিবরণ" /></td>
                  <td>{lines.length > 2 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label="সারি মুছুন" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>মোট</td>
                <td className="num dr">{formatMoney(dr, currency)}</td>
                <td className="num cr">{formatMoney(cr, currency)}</td>
                <td colSpan={2} className={diff === 0 ? "text-brand-700" : "text-credit"}>
                  {diff === 0 ? (dr > 0 ? "✔ ডেবিট = ক্রেডিট" : "") : `✘ পার্থক্য ${formatMoney(Math.abs(diff), currency)} (${diff > 0 ? "ক্রেডিট কম" : "ডেবিট কম"})`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-rule px-4 py-2.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}>+ আরেকটি লাইন</button>
          <FieldError name="lines" />
        </div>
      </section>
      <section className="panel p-4">
        <label className="label" htmlFor="v-narr">বিবরণ (ন্যারেশন)</label>
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
}: {
  action: FormAction;
  products: ProductOption[];
  units: UnitOption[];
  warehouses: WarehouseOption[];
  batches: BatchOption[];
  defaults: StockJournalDefaults;
  currency: string;
  cancelHref: string;
}) {
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
        <div className="panel-head"><h2 className="panel-title">স্টক সমন্বয় / স্থানান্তর</h2><span className="text-xs text-slate-500">স্থানান্তর: এক গুদাম থেকে “বাহির” ও অন্য গুদামে “আগমন” লাইন দিন</span></div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="min-w-56">পণ্য</th><th className="w-40">গুদাম</th><th className="w-36">দিক</th><th className="w-40">ব্যাচ</th><th className="w-28 text-right">পরিমাণ</th><th className="w-32 text-right">দর (আগমন)</th><th className="w-32 text-right">মূল্য</th><th className="w-10" /></tr></thead>
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
                        placeholder="পণ্য খুঁজুন — নাম, কোড/SKU, বারকোড"
                        create={{ units }}
                        currency={currency}
                        unitName={unitName}
                        priceOf={(x) => x.avgCost || x.purchasePrice}
                        ariaLabel={`পণ্য, সারি ${idx + 1}`}
                      />
                      <FieldError name={`lines.${idx}.productId`} />
                    </td>
                    <td>
                      <select className="input" value={l.warehouseId} onChange={(e) => update(l.key, { warehouseId: e.target.value })} aria-label="গুদাম">
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={l.direction} onChange={(e) => update(l.key, { direction: e.target.value })} aria-label="দিক">
                        <option value="-1">বাহির (ঘাটতি/নষ্ট)</option>
                        <option value="1">আগমন (উদ্বৃত্ত)</option>
                      </select>
                    </td>
                    <td><BatchCell product={p} inbound={l.direction === "1"} batches={batches} warehouseId={l.warehouseId} batchNo={l.batchNo} expiryDate={l.expiryDate} mfgDate={l.mfgDate} onChange={(patch) => update(l.key, patch)} /></td>
                    <td>
                      <input className="input-num" type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label="পরিমাণ" />
                      {p && <span className="text-[11px] text-slate-400">{unitName(p.unitId)}</span>}
                      <FieldError name={`lines.${idx}.quantity`} />
                    </td>
                    <td><input className="input-num" type="number" min="0" step="0.01" value={l.rate} placeholder={p ? String(p.avgCost || p.purchasePrice) : ""} disabled={l.direction !== "1"} onChange={(e) => update(l.key, { rate: e.target.value })} aria-label="দর" /></td>
                    <td className="num">{formatMoney(value(l), currency)}</td>
                    <td>{lines.length > 1 && <button type="button" className="btn-ghost btn-sm text-credit" aria-label="সারি মুছুন" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={6}>আগমন {formatMoney(vin, currency)} · বাহির {formatMoney(vout, currency)} · নিট সমন্বয়</td><td className="num">{formatMoney(vin - vout, currency)}</td><td /></tr></tfoot>
          </table>
        </div>
        <div className="border-t border-rule px-4 py-2.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}>+ আরেকটি লাইন</button>
          <FieldError name="lines" />
        </div>
      </section>
      <section className="panel p-4">
        <label className="label" htmlFor="v-narr">কারণ / বিবরণ</label>
        <textarea id="v-narr" rows={2} className="input" value={narration} onChange={(e) => setNarration(e.target.value)} />
      </section>
      <Footer cancelHref={cancelHref} label="স্টক জার্নাল সংরক্ষণ করুন" />
    </ActionForm>
  );
}
