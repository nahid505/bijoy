"use client";

// Paddy purchase (weighbridge slip): bags (information only) → gross − dhalta = net → mon → × rate = total.
// Net, mon and total update live while typing; the server recalculates the same way when saving.
import Link from "next/link";
import { EntryDateInput } from "@/components/entry-date-input";
import { useState } from "react";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchSelect } from "@/components/search-select";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption, PartyOption, ProductOption, WarehouseOption } from "@/components/trade-parts";
import { formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { KG_PER_MON, monAndKg, paddyFigures } from "@/lib/paddy";

export interface PaddyDefaults {
  date: string;
  supplier: PartyOption | null;
  product: ProductOption | null;
  warehouseId: string | null;
  batchNo: string;
  bagCount: string;
  grossKg: string;
  dhaltaKg: string;
  ratePerMon: string;
  paidAmount: string;
  cashAccountId: string;
  reference: string;
  notes: string;
}

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function PaddyPurchaseForm({ action, defaults, warehouses, cashAccounts, multiWarehouse, currency, dateLocked }: {
  action: FormAction; defaults: PaddyDefaults; warehouses: WarehouseOption[]; cashAccounts: AccountOption[]; multiWarehouse: boolean; currency: string;
  /** no transaction:change_date permission */
  dateLocked?: boolean;
}) {
  const [f, setF] = useState(defaults);
  const set = <K extends keyof PaddyDefaults>(k: K, v: PaddyDefaults[K]) => setF((x) => ({ ...x, [k]: v }));
  const fig = paddyFigures({ grossKg: n(f.grossKg), dhaltaKg: n(f.dhaltaKg), ratePerMon: n(f.ratePerMon) });
  const split = monAndKg(fig.netKg);
  const cashPurchase = !f.supplier;
  const paid = cashPurchase ? fig.totalPrice : n(f.paidAmount);
  const payload = JSON.stringify({
    date: f.date, reference: f.reference || null, narration: null, partyAccountId: f.supplier?.id ?? null, productId: f.product?.id ?? "",
    warehouseId: multiWarehouse ? f.warehouseId || null : null, batchNo: f.batchNo || null,
    bagCount: f.bagCount || 0, grossKg: f.grossKg, dhaltaKg: f.dhaltaKg || 0, ratePerMon: f.ratePerMon,
    paidAmount: cashPurchase ? fig.totalPrice : f.paidAmount || 0, cashAccountId: f.cashAccountId || null, notes: f.notes || null,
  });
  const auto = "input-num bg-ink-50 font-semibold";

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="তারিখ *" name="date"><EntryDateInput id="date" value={f.date} onChange={(v) => set("date", v)} locked={dateLocked} /></Field>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="supplier">সরবরাহকারী (কৃষক / ব্যাপারী)</label>
          <SearchSelect kind="suppliers" id="supplier" value={f.supplier} onChange={(s) => set("supplier", s)} noneLabel="নগদ ক্রয় (সরবরাহকারী ছাড়া)" placeholder="নাম বা মোবাইল দিয়ে খুঁজুন" create={{}} currency={currency} />
          <FieldError name="partyAccountId" />
        </div>
        <Field label="রেফারেন্স / স্লিপ নং" name="reference"><input id="reference" className="input" value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="product">পণ্য (ধান) *</label>
          <SearchSelect kind="products" id="product" value={f.product} onChange={(p) => set("product", p)} placeholder="ধান — পণ্য খুঁজুন" currency={currency} />
          <FieldError name="productId" />
        </div>
        {multiWarehouse && warehouses.length > 1 && (
          <Field label="গুদাম" name="warehouseId">
            <select id="warehouseId" className="input" value={f.warehouseId ?? ""} onChange={(e) => set("warehouseId", e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </Field>
        )}
        {f.product?.trackBatch && <Field label="ব্যাচ / লট নং *" name="batchNo"><input id="batchNo" className="input" value={f.batchNo} onChange={(e) => set("batchNo", e.target.value)} /></Field>}
      </div>

      <section className="rounded-lg border border-rule p-4" aria-label="ওজন ও দাম">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">ওজন ও দামের হিসাব <span className="text-xs font-normal text-slate-500">(১ মণ = {toBnDigits(KG_PER_MON)} কেজি)</span></h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="১. বস্তার সংখ্যা" name="bagCount" hint="শুধু চালানে দেখানোর জন্য — হিসাবে প্রভাব নেই">
            <input id="bagCount" className="input-num" inputMode="numeric" value={f.bagCount} onChange={(e) => set("bagCount", e.target.value.replace(/[^0-9]/g, ""))} placeholder="০" />
          </Field>
          <Field label="২. মোট ওজন (কেজি) *" name="grossKg">
            <input id="grossKg" className="input-num" inputMode="decimal" value={f.grossKg} onChange={(e) => set("grossKg", e.target.value)} placeholder="যেমন ১০৫০" />
          </Field>
          <Field label="৩. ঢলতা (কেজি)" name="dhaltaKg" hint="মোট ওজন থেকে সরাসরি বাদ যাবে">
            <input id="dhaltaKg" className="input-num" inputMode="decimal" value={f.dhaltaKg} onChange={(e) => set("dhaltaKg", e.target.value)} placeholder="০" />
          </Field>
          <Field label="৪. নিট ওজন (কেজি)" name="netKg" hint={fig.netKg > 0 ? `${toBnDigits(split.mon)} মণ ${formatQty(split.kg)} কেজি` : "মোট − ঢলতা"}>
            <output id="netKg" className={`${auto} block`} aria-live="polite">{formatQty(fig.netKg)}</output>
          </Field>
          <Field label="৫. মণ" name="mon" hint="নিট ÷ ৪০ (দশমিক ২ ঘর)">
            <output id="mon" className={`${auto} block`} aria-live="polite">{toBnDigits(fig.mon.toFixed(2))}</output>
          </Field>
          <Field label="৬. প্রতি মণের দর *" name="ratePerMon">
            <input id="ratePerMon" className="input-num" inputMode="decimal" value={f.ratePerMon} onChange={(e) => set("ratePerMon", e.target.value)} placeholder="যেমন ১২৫০" />
          </Field>
          <Field label="৭. মোট দাম" name="totalPrice" hint="মণ × দর" className="lg:col-span-2">
            <output id="totalPrice" className={`${auto} block text-lg text-brand-800`} aria-live="polite">{formatMoney(fig.totalPrice, currency)}</output>
          </Field>
          <Field label="৮. নোট" name="notes" hint="গাড়ি নম্বর, ড্রাইভার বা যেকোনো বিশেষ নোট" className="sm:col-span-2 lg:col-span-4">
            <textarea id="notes" className="input min-h-[70px]" maxLength={500} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="যেমন: ট্রাক ঢাকা মেট্রো-ট ১১-২২৩৩, ড্রাইভার রফিক" />
          </Field>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="পরিশোধ">
        {!cashPurchase && (
          <Field label="এখন পরিশোধ" name="paidAmount" hint={`বাকি থাকবে ${formatMoney(Math.max(0, fig.totalPrice - paid), currency)}`}>
            <input id="paidAmount" className="input-num" inputMode="decimal" value={f.paidAmount} onChange={(e) => set("paidAmount", e.target.value)} placeholder="০" />
          </Field>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="cashAccountId">{cashPurchase ? "পরিশোধ (নগদ ক্রয় — পুরো টাকা) *" : "পরিশোধের হিসাব"}</label>
          <SearchableAccountSelect id="cashAccountId" scope="cash" known={cashAccounts} value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)} placeholder="নগদ / ব্যাংক / মোবাইল ব্যাংকিং" currency={currency} />
          <FieldError name="cashAccountId" />
        </div>
      </section>

      <div className="flex gap-2"><SubmitButton>ধান ক্রয় সংরক্ষণ করুন</SubmitButton><Link prefetch={false} href="/purchases/paddy" className="btn-secondary">বাতিল</Link></div>
    </ActionForm>
  );
}
