"use client";

import { formatDate, formatDrCr, formatMoney, formatQty } from "@/lib/format";
import { round2 } from "@/lib/calc";
import { SearchableAccountSelect } from "./account-select";

// ───────────────────────── shared option types ─────────────────────────

export interface AccountOption {
  id: string;
  name: string;
  group: string;
  balance?: number;
}
export interface PartyOption extends AccountOption {
  mobile?: string | null;
  creditLimit?: number;
  creditDays?: number;
  overdue?: number;
}
export interface UnitOption {
  id: string;
  name: string;
  baseUnitId: string | null;
  factor: number;
}
export interface ProductOption {
  id: string;
  name: string;
  code: string | null;
  barcode: string | null;
  unitId: string;
  salePrice: number;
  wholesalePrice: number;
  purchasePrice: number;
  avgCost: number;
  stock: number;
  trackBatch: boolean;
  /** depot: commission per base unit for a DO release */
  depotCommissionRate?: number;
}
export interface WarehouseOption {
  id: string;
  name: string;
}
export interface BatchOption {
  productId: string;
  warehouseId: string;
  batchNo: string;
  expiryDate: string | null;
  quantity: number;
  /** expiry status on the business date: days to expiry (negative = expired), null = no expiry */
  daysLeft: number | null;
}
export interface PaymentRow {
  key: number;
  accountId: string;
  amount: string;
  reference: string;
}

import { useT } from "./lang";

let seq = 5000;
export const nextKey = () => ++seq;

/** Party summary under the party picker: balance, credit limit, overdue. */
export function PartyInfo({ party, currency, projectedDue }: { party?: PartyOption; currency: string; projectedDue?: number }) {
  const t = useT();
  if (!party) return null;
  const over = party.creditLimit && projectedDue !== undefined && projectedDue > party.creditLimit;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {party.mobile && <p className="text-slate-500">📞 {party.mobile}</p>}
      {party.balance !== undefined && <p className={party.balance > 0 ? "font-semibold text-debit" : "text-slate-600"}>{t("বর্তমান ব্যালেন্স:")} {formatDrCr(party.balance, currency)}</p>}
      {!!party.overdue && party.overdue > 0 && <p className="font-semibold text-credit">{t("মেয়াদোত্তীর্ণ বকেয়া:")} {formatMoney(party.overdue, currency)}</p>}
      {!!party.creditLimit && (
        <p className={over ? "font-semibold text-credit" : "text-slate-500"}>
          {t("ক্রেডিট সীমা")} {formatMoney(party.creditLimit, currency)}
          {projectedDue !== undefined && ` · ${t("বিক্রয়ের পর বাকি")} ${formatMoney(projectedDue, currency)}`}
          {over && ` ${t("— সীমা অতিক্রম!")}`}
        </p>
      )}
    </div>
  );
}

/** Split payment rows: cash + bKash + bank … each with an optional reference. */
export function PaymentRows({
  rows,
  setRows,
  cashAccounts,
  total,
  currency,
  label,
  book,
}: {
  rows: PaymentRow[];
  setRows: (r: PaymentRow[]) => void;
  cashAccounts: AccountOption[];
  total: number;
  currency: string;
  label: string;
  book?: "depot";
}) {
  const t = useT();
  const paid = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const update = (key: number, patch: Partial<PaymentRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label mb-0">{t(label)}</span>
        <div className="flex gap-1">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setRows([{ key: nextKey(), accountId: cashAccounts[0]?.id ?? "", amount: String(total), reference: "" }])}>
            {t("সম্পূর্ণ নগদ")}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setRows([])}>{t("বাকি")}</button>
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-12 gap-1.5">
          <div className="col-span-5"><SearchableAccountSelect scope="cash" book={book} known={cashAccounts} value={r.accountId} onChange={(v) => update(r.key, { accountId: v })} placeholder={t("মাধ্যম")} ariaLabel={t("পরিশোধের মাধ্যম")} currency={currency} /></div>
          <input className="input-num col-span-3" type="text" inputMode="decimal" data-numeric min="0" step="0.01" value={r.amount} placeholder={t("টাকা")} onChange={(e) => update(r.key, { amount: e.target.value })} aria-label={t("টাকা")} />
          <input className="input col-span-3" value={r.reference} placeholder={t("রেফ/TrxID")} onChange={(e) => update(r.key, { reference: e.target.value })} aria-label={t("রেফারেন্স")} />
          <button type="button" className="btn-ghost btn-sm col-span-1 text-credit" aria-label={t("মাধ্যম মুছুন")} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>✕</button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className="btn-secondary btn-sm" onClick={() => setRows([...rows, { key: nextKey(), accountId: cashAccounts.find((c) => !rows.some((r) => r.accountId === c.id))?.id ?? "", amount: String(Math.max(round2(total - paid), 0) || ""), reference: "" }])}>
          + {t("আরেক মাধ্যম")}
        </button>
        <span className="text-xs text-slate-500">{t("মোট পরিশোধ:")} <b className="tabular-nums text-ink-900">{formatMoney(paid, currency)}</b></span>
      </div>
    </div>
  );
}

export function paymentsPayload(rows: PaymentRow[]) {
  return rows.filter((r) => r.accountId && Number(r.amount) > 0).map((r) => ({ accountId: r.accountId, amount: Number(r.amount), reference: r.reference || null }));
}

/** Batch picker (outbound) or batch/expiry entry (inbound) for batch-tracked products. */
export function BatchCell({
  product,
  inbound,
  batches,
  warehouseId,
  batchNo,
  expiryDate,
  mfgDate = "",
  fefo = false,
  blockExpired = false,
  onChange,
}: {
  product?: ProductOption;
  inbound: boolean;
  batches: BatchOption[];
  warehouseId: string;
  batchNo: string;
  expiryDate: string;
  mfgDate?: string;
  /** sales: an empty choice means "automatic, first-expired-first-out" */
  fefo?: boolean;
  /** sales with expired selling disabled: expired batches cannot be chosen */
  blockExpired?: boolean;
  onChange: (patch: { batchNo?: string; expiryDate?: string; mfgDate?: string }) => void;
}) {
  const t = useT();
  if (!product?.trackBatch) return <span className="text-xs text-slate-300">—</span>;
  if (inbound)
    return (
      <div className="space-y-1">
        <input className="input" placeholder={t("ব্যাচ / লট নং")} value={batchNo} onChange={(e) => onChange({ batchNo: e.target.value })} aria-label={t("ব্যাচ নং")} />
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          <span className="w-10 shrink-0">{t("উৎপাদন")}</span>
          <input className="input py-1 text-xs" type="date" value={mfgDate} onChange={(e) => onChange({ mfgDate: e.target.value })} aria-label={t("উৎপাদনের তারিখ")} />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          <span className="w-10 shrink-0">{t("মেয়াদ")}</span>
          <input className="input py-1 text-xs" type="date" value={expiryDate} onChange={(e) => onChange({ expiryDate: e.target.value })} aria-label={t("মেয়াদ শেষের তারিখ")} />
        </label>
      </div>
    );
  const list = batches.filter((b) => b.productId === product.id && b.warehouseId === warehouseId);
  const chosen = list.find((b) => b.batchNo === batchNo);
  return (
    <div>
      <select className="input" value={batchNo} onChange={(e) => onChange({ batchNo: e.target.value })} aria-label={t("ব্যাচ")}>
        <option value="">{fefo ? t("স্বয়ংক্রিয় (FEFO)") : t("— ব্যাচ —")}</option>
        {list.map((b) => {
          const expired = b.daysLeft !== null && b.daysLeft < 0;
          return (
            <option key={b.batchNo} value={b.batchNo} disabled={expired && blockExpired}>
              {expired ? "⛔ " : b.daysLeft !== null && b.daysLeft <= 30 ? "🟠 " : ""}
              {b.batchNo} · {formatQty(b.quantity)}
              {b.expiryDate ? ` · ${t("মেয়াদ")} ${formatDate(b.expiryDate)}` : ""}
              {expired ? ` (${t("মেয়াদোত্তীর্ণ")})` : ""}
            </option>
          );
        })}
      </select>
      {chosen && chosen.daysLeft !== null && chosen.daysLeft < 0 && <p className="mt-1 text-xs text-credit">{t("মেয়াদোত্তীর্ণ ব্যাচ")}</p>}
      {fefo && !batchNo && list.length > 0 && <p className="mt-1 text-[11px] text-slate-500">{t("আগে মেয়াদ শেষ হবে এমন ব্যাচ থেকে কাটা হবে")}</p>}
    </div>
  );
}
