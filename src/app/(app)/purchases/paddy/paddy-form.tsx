"use client";

// Paddy purchase (weighbridge slip): bags (information only) → gross − dhalta = net → mon → × rate = total.
// Weighbridge: loaded vehicle − empty vehicle = gross (typed gross is used when the vehicle weights are empty).
// Net, mon and total update live while typing; the server recalculates the same way when saving.
import Link from "next/link";
import { EntryDateInput } from "@/components/entry-date-input";
import { useState } from "react";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchSelect } from "@/components/search-select";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption, PartyOption, ProductOption, WarehouseOption } from "@/components/trade-parts";
import { formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { KG_PER_MON, monAndKg, PADDY_VARIETIES, paddyFigures, weighbridgeGross } from "@/lib/paddy";
import { useT } from "@/components/lang";

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
  variety: string;
  moisturePct: string;
  vehicleGrossKg: string;
  vehicleTareKg: string;
  labourCost: string;
}

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function PaddyPurchaseForm({ action, defaults, warehouses, cashAccounts, multiWarehouse, currency, dateLocked }: {
  action: FormAction; defaults: PaddyDefaults; warehouses: WarehouseOption[]; cashAccounts: AccountOption[]; multiWarehouse: boolean; currency: string;
  /** no transaction:change_date permission */
  dateLocked?: boolean;
}) {
  const t = useT();
  const [f, setF] = useState(defaults);
  const set = <K extends keyof PaddyDefaults>(k: K, v: PaddyDefaults[K]) => setF((x) => ({ ...x, [k]: v }));
  const wbGross = weighbridgeGross(n(f.vehicleGrossKg), n(f.vehicleTareKg));
  const grossKg = wbGross ?? n(f.grossKg);
  const fig = paddyFigures({ grossKg, dhaltaKg: n(f.dhaltaKg), ratePerMon: n(f.ratePerMon) });
  const split = monAndKg(fig.netKg);
  const cashPurchase = !f.supplier;
  const paid = cashPurchase ? fig.totalPrice : n(f.paidAmount);
  const payload = JSON.stringify({
    date: f.date, reference: f.reference || null, narration: null, partyAccountId: f.supplier?.id ?? null, productId: f.product?.id ?? "",
    warehouseId: multiWarehouse ? f.warehouseId || null : null, batchNo: f.batchNo || null,
    bagCount: f.bagCount || 0, grossKg: wbGross ?? f.grossKg, dhaltaKg: f.dhaltaKg || 0, ratePerMon: f.ratePerMon,
    variety: f.variety || null, moisturePct: f.moisturePct || null, vehicleGrossKg: f.vehicleGrossKg || null, vehicleTareKg: f.vehicleTareKg || null, labourCost: f.labourCost || 0,
    paidAmount: cashPurchase ? fig.totalPrice : f.paidAmount || 0, cashAccountId: f.cashAccountId || null, notes: f.notes || null,
  });
  const auto = "input-num bg-ink-50 font-semibold";

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="তারিখ *" name="date"><EntryDateInput id="date" value={f.date} onChange={(v) => set("date", v)} locked={dateLocked} /></Field>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="supplier">{t("সরবরাহকারী (কৃষক / ব্যাপারী)")}</label>
          <SearchSelect kind="suppliers" id="supplier" value={f.supplier} onChange={(s) => set("supplier", s)} noneLabel={t("নগদ ক্রয় (সরবরাহকারী ছাড়া)")} placeholder={t("নাম বা মোবাইল দিয়ে খুঁজুন")} create={{}} currency={currency} />
          <FieldError name="partyAccountId" />
        </div>
        <Field label="রেফারেন্স / স্লিপ নং" name="reference"><input id="reference" className="input" value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="product">{t("পণ্য (ধান) *")}</label>
          <SearchSelect kind="products" id="product" value={f.product} onChange={(p) => set("product", p)} placeholder={t("ধান — পণ্য খুঁজুন")} currency={currency} />
          <FieldError name="productId" />
        </div>
        {multiWarehouse && warehouses.length > 1 && (
          <Field label="গুদাম" name="warehouseId">
            <select id="warehouseId" className="input" value={f.warehouseId ?? ""} onChange={(e) => set("warehouseId", e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </Field>
        )}
        <Field label="ধানের জাত" name="variety" hint="তালিকা থেকে বাছুন বা লিখুন">
          <input id="variety" className="input" list="paddy-varieties" maxLength={60} value={f.variety} onChange={(e) => set("variety", e.target.value)} placeholder={t("যেমন মিনিকেট")} />
          <datalist id="paddy-varieties">{PADDY_VARIETIES.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label="আর্দ্রতা (%)" name="moisturePct" hint="তথ্যের জন্য">
          <input id="moisturePct" className="input-num" inputMode="decimal" data-numeric value={f.moisturePct} onChange={(e) => set("moisturePct", e.target.value)} placeholder={t("যেমন ১৪")} />
        </Field>
        {f.product?.trackBatch && <Field label="ব্যাচ / লট নং *" name="batchNo"><input id="batchNo" className="input" value={f.batchNo} onChange={(e) => set("batchNo", e.target.value)} /></Field>}
      </div>

      <section className="rounded-lg border border-rule p-4" aria-label={t("ওজন ও দাম")}>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">{t("ওজন ও দামের হিসাব")} <span className="text-xs font-normal text-slate-500">({t("১ মণ = {n} কেজি", { n: toBnDigits(KG_PER_MON) })})</span></h2>
        <div className="mb-3 grid gap-3 rounded-md bg-ink-50 p-3 sm:grid-cols-3" id="weighbridge">
          <Field label="গাড়িসহ ওজন (কেজি)" name="vehicleGrossKg" hint="ওয়েব্রিজ স্কেল — ধান বোঝাই গাড়ি">
            <input id="vehicleGrossKg" className="input-num" inputMode="decimal" data-numeric value={f.vehicleGrossKg} onChange={(e) => set("vehicleGrossKg", e.target.value)} placeholder={t("যেমন ১২৫০০")} />
          </Field>
          <Field label="খালি গাড়ির ওজন (কেজি)" name="vehicleTareKg" hint="ধান নামানোর পর">
            <input id="vehicleTareKg" className="input-num" inputMode="decimal" data-numeric value={f.vehicleTareKg} onChange={(e) => set("vehicleTareKg", e.target.value)} placeholder={t("যেমন ৪৫০০")} />
          </Field>
          <p className="self-end pb-2 text-xs text-slate-500">{t("দুটো দিলে ধানের মোট ওজন = গাড়িসহ − খালি গাড়ি, নিজে থেকে বসবে। না দিলে নিচে মোট ওজন লিখুন।")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="১. বস্তার সংখ্যা" name="bagCount" hint="শুধু চালানে দেখানোর জন্য — হিসাবে প্রভাব নেই">
            <input id="bagCount" className="input-num" inputMode="numeric" data-numeric value={f.bagCount} onChange={(e) => set("bagCount", e.target.value.replace(/[^0-9]/g, ""))} placeholder="০" />
          </Field>
          <Field label="২. মোট ওজন (কেজি) *" name="grossKg" hint={wbGross !== null ? "গাড়িসহ − খালি গাড়ি (স্বয়ংক্রিয়)" : undefined}>
            {wbGross !== null
              ? <output id="grossKg" className={`${auto} block`} aria-live="polite">{formatQty(wbGross)}</output>
              : <input id="grossKg" className="input-num" inputMode="decimal" data-numeric value={f.grossKg} onChange={(e) => set("grossKg", e.target.value)} placeholder={t("যেমন ১০৫০")} />}
          </Field>
          <Field label="৩. ঢলতা (কেজি)" name="dhaltaKg" hint="মোট ওজন থেকে সরাসরি বাদ যাবে">
            <input id="dhaltaKg" className="input-num" inputMode="decimal" data-numeric value={f.dhaltaKg} onChange={(e) => set("dhaltaKg", e.target.value)} placeholder="০" />
          </Field>
          <Field label="৪. নিট ওজন (কেজি)" name="netKg" hint={fig.netKg > 0 ? `${toBnDigits(split.mon)} মণ ${formatQty(split.kg)} কেজি` : "মোট − ঢলতা"}>
            <output id="netKg" className={`${auto} block`} aria-live="polite">{formatQty(fig.netKg)}</output>
          </Field>
          <Field label="৫. মণ" name="mon" hint="নিট ÷ ৪০ (দশমিক ২ ঘর)">
            <output id="mon" className={`${auto} block`} aria-live="polite">{toBnDigits(fig.mon.toFixed(2))}</output>
          </Field>
          <Field label="৬. প্রতি মণের দর *" name="ratePerMon">
            <input id="ratePerMon" className="input-num" inputMode="decimal" data-numeric value={f.ratePerMon} onChange={(e) => set("ratePerMon", e.target.value)} placeholder={t("যেমন ১২৫০")} />
          </Field>
          <Field label="৭. মোট দাম" name="totalPrice" hint="মণ × দর" className="lg:col-span-2">
            <output id="totalPrice" className={`${auto} block text-lg text-brand-800`} aria-live="polite">{formatMoney(fig.totalPrice, currency)}</output>
          </Field>
          <Field label="৮. নোট" name="notes" hint="গাড়ি নম্বর, ড্রাইভার বা যেকোনো বিশেষ নোট" className="sm:col-span-2 lg:col-span-4">
            <textarea id="notes" className="input min-h-[70px]" maxLength={500} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("যেমন: ট্রাক ঢাকা মেট্রো-ট ১১-২২৩৩, ড্রাইভার রফিক")} />
          </Field>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("পরিশোধ")}>
        <Field label="লেবার খরচ (নামানো/বহন)" name="labourCost" hint={n(f.labourCost) > 0 ? "নিচের নগদ/ব্যাংক থেকে আলাদা খরচ হিসেবে পোস্ট হবে" : "না থাকলে খালি রাখুন"}>
          <input id="labourCost" className="input-num" inputMode="decimal" data-numeric value={f.labourCost} onChange={(e) => set("labourCost", e.target.value)} placeholder="০" />
        </Field>
        {!cashPurchase && (
          <Field label="এখন পরিশোধ" name="paidAmount" hint={`বাকি থাকবে ${formatMoney(Math.max(0, fig.totalPrice - paid), currency)}`}>
            <input id="paidAmount" className="input-num" inputMode="decimal" data-numeric value={f.paidAmount} onChange={(e) => set("paidAmount", e.target.value)} placeholder="০" />
          </Field>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="cashAccountId">{cashPurchase ? t("পরিশোধ (নগদ ক্রয় — পুরো টাকা) *") : n(f.labourCost) > 0 ? t("পরিশোধ ও লেবার খরচের হিসাব *") : t("পরিশোধের হিসাব")}</label>
          <SearchableAccountSelect id="cashAccountId" scope="cash" known={cashAccounts} value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)} placeholder={t("নগদ / ব্যাংক / মোবাইল ব্যাংকিং")} currency={currency} />
          <FieldError name="cashAccountId" />
        </div>
      </section>

      <div className="flex gap-2"><SubmitButton>{t("ধান ক্রয় সংরক্ষণ করুন")}</SubmitButton><Link prefetch={false} href="/purchases/paddy" className="btn-secondary">{t("বাতিল")}</Link></div>
    </ActionForm>
  );
}
