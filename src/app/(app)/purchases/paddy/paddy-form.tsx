"use client";

// Multi-variety paddy purchase (weighbridge slip cart):
//   Master Header (date, party/supplier, reference, warehouse, logistics)
//   → Entry & Calculation Box (product, bags, weighbridge/gross, dhalta, rate → Add to Cart)
//   → Preview & Revise Table (edit/delete rows + combined totals)
//   → Final Payment & Save (labourCost, paidAmount, cashAccount, notes → single voucher).
import Link from "next/link";
import { useRef, useState } from "react";
import { EntryDateInput } from "@/components/entry-date-input";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchSelect } from "@/components/search-select";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption, PartyOption, ProductOption, WarehouseOption } from "@/components/trade-parts";
import { PartyInfo } from "@/components/trade-parts";
import { formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { KG_PER_MON, monAndKg, PADDY_VARIETIES, paddyFigures, summarizePaddyLines, weighbridgeGross } from "@/lib/paddy";
import { useT } from "@/components/lang";
import type { CompanyVehicle } from "@prisma/client";

export interface PaddyItemDraft {
  key: string;
  product: ProductOption | null;
  batchNo: string;
  variety: string;
  moisturePct: string;
  bagCount: string;
  juteBagQty: string;
  plasticBagQty: string;
  vehicleGrossKg: string;
  vehicleTareKg: string;
  grossKg: string;
  dhaltaKg: string;
  ratePerMon: string;
}

export interface PaddyDefaults {
  date: string;
  supplier: PartyOption | null;
  warehouseId: string | null;
  paidAmount: string;
  cashAccountId: string;
  reference: string;
  notes: string;
  labourCost: string;
  // Optional initial entry product (e.g. default paddy on new page) & existing items (on edit page)
  initialProduct?: ProductOption | null;
  items?: PaddyItemDraft[];
  // Logistics
  destination?: string;
  vehicleNo?: string;
  driverName?: string;
  driverMobile?: string;
  transportFare?: string;
}

const n = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : 0);
let seq = 1;
const nextItemKey = () => `pi-${Date.now()}-${seq++}`;

const emptyEntry = (product: ProductOption | null = null): PaddyItemDraft => ({
  key: nextItemKey(),
  product,
  batchNo: "",
  variety: "",
  moisturePct: "",
  bagCount: "",
  juteBagQty: "",
  plasticBagQty: "",
  vehicleGrossKg: "",
  vehicleTareKg: "",
  grossKg: "",
  dhaltaKg: "",
  ratePerMon: "",
});

export function PaddyPurchaseForm({ action, defaults, warehouses, cashAccounts, multiWarehouse, currency, dateLocked, companyVehicles }: {
  action: FormAction;
  defaults: PaddyDefaults;
  warehouses: WarehouseOption[];
  cashAccounts: AccountOption[];
  multiWarehouse: boolean;
  currency: string;
  /** no transaction:change_date permission */
  dateLocked?: boolean;
  companyVehicles?: CompanyVehicle[];
}) {
  const t = useT();
  const entryRef = useRef<HTMLElement>(null);

  // ── Master Header + Payment State ──
  const [header, setHeader] = useState({
    date: defaults.date,
    supplier: defaults.supplier,
    warehouseId: defaults.warehouseId,
    reference: defaults.reference,
    notes: defaults.notes,
    labourCost: defaults.labourCost,
    paidAmount: defaults.paidAmount,
    cashAccountId: defaults.cashAccountId,
    destination: defaults.destination ?? "",
    vehicleNo: defaults.vehicleNo ?? "",
    driverName: defaults.driverName ?? "",
    driverMobile: defaults.driverMobile ?? "",
    transportFare: defaults.transportFare ?? "",
  });
  const setH = <K extends keyof typeof header>(k: K, v: (typeof header)[K]) => setHeader((x) => ({ ...x, [k]: v }));

  // ── Multi-Variety Paddy Cart State ──
  const [paddyItems, setPaddyItems] = useState<PaddyItemDraft[]>(defaults.items ?? []);
  const [entry, setEntry] = useState<PaddyItemDraft>(() => emptyEntry(defaults.items?.length ? null : defaults.initialProduct ?? null));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);

  const setE = <K extends keyof PaddyItemDraft>(k: K, v: PaddyItemDraft[K]) => {
    setItemError(null);
    setEntry((x) => ({ ...x, [k]: v }));
  };

  // Live calculations for current entry box
  const wbGross = weighbridgeGross(n(entry.vehicleGrossKg), n(entry.vehicleTareKg));
  const entryGrossKg = wbGross ?? n(entry.grossKg);
  const fig = paddyFigures({ grossKg: entryGrossKg, dhaltaKg: n(entry.dhaltaKg), ratePerMon: n(entry.ratePerMon) });
  const split = monAndKg(fig.netKg);
  const entryBags = (n(entry.juteBagQty) + n(entry.plasticBagQty)) || n(entry.bagCount);

  // Live aggregated totals for the cart table + final payment
  const cartSummary = summarizePaddyLines(
    paddyItems.map((it) => ({
      bagCount: n(it.bagCount),
      juteBagQty: n(it.juteBagQty),
      plasticBagQty: n(it.plasticBagQty),
      vehicleGrossKg: n(it.vehicleGrossKg) || null,
      vehicleTareKg: n(it.vehicleTareKg) || null,
      grossKg: n(it.grossKg),
      dhaltaKg: n(it.dhaltaKg),
      ratePerMon: n(it.ratePerMon),
    })),
  );

  const cashPurchase = !header.supplier;
  const paid = cashPurchase ? cartSummary.totalPrice : n(header.paidAmount);

  const handleSupplierChange = (s: PartyOption | null) => {
    setHeader((x) => ({
      ...x,
      supplier: s,
      destination: s?.address ? s.address : x.destination,
    }));
  };

  const handleVehicleChange = (val: string) => {
    const matched = companyVehicles?.find(
      (v) => v.vehicleNo.toLowerCase() === val.trim().toLowerCase(),
    );
    setHeader((x) => ({
      ...x,
      vehicleNo: val,
      driverName: matched?.driverName && !x.driverName ? matched.driverName : x.driverName,
      driverMobile: matched?.driverMobile && !x.driverMobile ? matched.driverMobile : x.driverMobile,
    }));
  };

  const handleAddOrUpdateItem = () => {
    if (!entry.product) {
      setItemError(t("অনুগ্রহ করে ধানের নাম (পণ্য) নির্বাচন করুন"));
      return;
    }
    if (entry.product.trackBatch && !entry.batchNo.trim()) {
      setItemError(t("এই পণ্যের জন্য ব্যাচ / লট নং দিন"));
      return;
    }
    const vg = n(entry.vehicleGrossKg);
    const vt = n(entry.vehicleTareKg);
    if ((vg > 0) !== (vt > 0)) {
      setItemError(t("গাড়িসহ ও খালি গাড়ির — দুটো ওজনই দিন (অথবা কোনোটিই নয়)"));
      return;
    }
    if (vg > 0 && vt > 0 && vt >= vg) {
      setItemError(t("খালি গাড়ির ওজন গাড়িসহ ওজনের চেয়ে কম হতে হবে"));
      return;
    }
    if (!(entryGrossKg > 0)) {
      setItemError(t("মোট ওজন দিন (অথবা গাড়িসহ ও খালি গাড়ির ওজন)"));
      return;
    }
    if (n(entry.dhaltaKg) < 0 || n(entry.dhaltaKg) >= entryGrossKg) {
      setItemError(t("ঢলতা মোট ওজনের চেয়ে কম হতে হবে"));
      return;
    }
    if (!(fig.mon > 0)) {
      setItemError(t("নিট ওজন খুব কম — কমপক্ষে ০.০১ মণ হতে হবে"));
      return;
    }
    if (!(n(entry.ratePerMon) > 0)) {
      setItemError(t("প্রতি মণের দর দিন"));
      return;
    }

    const savedItem: PaddyItemDraft = { ...entry, key: editingIndex !== null ? paddyItems[editingIndex]?.key ?? entry.key : nextItemKey() };
    setPaddyItems((prev) => (editingIndex !== null ? prev.map((it, i) => (i === editingIndex ? savedItem : it)) : [...prev, savedItem]));
    setEditingIndex(null);
    setItemError(null);
    setEntry(emptyEntry(null));
  };

  const handleEditRow = (idx: number) => {
    const row = paddyItems[idx];
    if (!row) return;
    setEntry({ ...row });
    setEditingIndex(idx);
    setItemError(null);
    entryRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const handleCancelEditRow = () => {
    setEditingIndex(null);
    setItemError(null);
    setEntry(emptyEntry(null));
  };

  const handleDeleteRow = (idx: number) => {
    setPaddyItems((prev) => prev.filter((_, i) => i !== idx));
    if (editingIndex === idx) {
      setEditingIndex(null);
      setEntry(emptyEntry(null));
    } else if (editingIndex !== null && idx < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const payload = JSON.stringify({
    date: header.date,
    reference: header.reference || null,
    narration: null,
    partyAccountId: header.supplier?.id ?? null,
    warehouseId: multiWarehouse ? header.warehouseId || null : null,
    destination: header.destination || null,
    vehicleNo: header.vehicleNo || null,
    driverName: header.driverName || null,
    driverMobile: header.driverMobile || null,
    transportFare: n(header.transportFare),
    labourCost: n(header.labourCost),
    paidAmount: cashPurchase ? cartSummary.totalPrice : n(header.paidAmount),
    cashAccountId: header.cashAccountId || null,
    notes: header.notes || null,
    items: paddyItems.map((it) => {
      const itemWb = weighbridgeGross(n(it.vehicleGrossKg), n(it.vehicleTareKg));
      const jute = n(it.juteBagQty);
      const plastic = n(it.plasticBagQty);
      const bags = jute + plastic > 0 ? jute + plastic : n(it.bagCount);
      return {
        productId: it.product?.id ?? "",
        batchNo: it.batchNo || null,
        juteBagQty: jute,
        plasticBagQty: plastic,
        totalBags: bags,
        bagCount: bags,
        variety: it.variety || null,
        moisturePct: it.moisturePct || null,
        vehicleGrossKg: it.vehicleGrossKg || null,
        vehicleTareKg: it.vehicleTareKg || null,
        grossKg: itemWb ?? n(it.grossKg),
        dhaltaKg: n(it.dhaltaKg),
        ratePerMon: n(it.ratePerMon),
      };
    }),
  });

  const auto = "input-num bg-ink-50 font-semibold";
  const canSubmit = paddyItems.length > 0 && editingIndex === null;

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />

      {/* ── ১. মাস্টার হেডার: তারিখ, পার্টি, স্লিপ নং, গুদাম এবং পরিবহন ও ড্রাইভার ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="তারিখ *" name="date">
          <EntryDateInput id="date" value={header.date} onChange={(v) => setH("date", v)} locked={dateLocked} />
        </Field>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="supplier">{t("সরবরাহকারী / পার্টি (কৃষক / ব্যাপারী)")}</label>
          <SearchSelect
            kind="parties"
            partyKind="SUPPLIER"
            id="supplier"
            value={header.supplier}
            onChange={handleSupplierChange}
            noneLabel={t("নগদ ক্রয় (পার্টি ছাড়া)")}
            placeholder={t("নাম, মোবাইল বা কোড দিয়ে খুঁজুন — সরবরাহকারী, কাস্টমার, মালিক")}
            create={{}}
            currency={currency}
          />
          <PartyInfo party={header.supplier ?? undefined} currency={currency} />
          <FieldError name="partyAccountId" />
        </div>
        <Field label="রেফারেন্স / স্লিপ নং" name="reference">
          <input id="reference" className="input" value={header.reference} onChange={(e) => setH("reference", e.target.value)} />
        </Field>
        {multiWarehouse && warehouses.length > 1 && (
          <Field label="গুদাম" name="warehouseId">
            <select id="warehouseId" className="input" value={header.warehouseId ?? ""} onChange={(e) => setH("warehouseId", e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        )}
      </div>

      {/* পরিবহন ও ড্রাইভার ট্রিপ ট্র্যাকিং (লজিস্টিকস) */}
      <section className="panel border border-slate-200 bg-slate-50/60 p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <span>🚚</span>
            <span>{t("পরিবহন ও ড্রাইভার ট্রিপ ট্র্যাকিং (লজিস্টিকস)")}</span>
          </h3>
          <span className="text-[11px] text-slate-500">
            {t("গাড়ির নম্বর ও ড্রাইভার দিলে ট্রিপ লেজারে বকেয়া যুক্ত হবে")}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label text-xs" htmlFor="paddy-destination">
              {t("গন্তব্য / রুটের বিবরণ")}
              {header.supplier?.address && header.destination === header.supplier.address && (
                <span className="ml-1 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-normal text-emerald-600">
                  {t("অটো-ফিল")}
                </span>
              )}
            </label>
            <input
              id="paddy-destination"
              type="text"
              className="input text-xs"
              value={header.destination}
              onChange={(e) => setH("destination", e.target.value)}
              placeholder={t("যেমন: বীরগঞ্জ মিল, দিনাজপুর মোকাম")}
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="paddy-vehicle">{t("গাড়ির নম্বর")}</label>
            <input
              list="company-vehicles-paddy"
              id="paddy-vehicle"
              type="text"
              className="input text-xs"
              value={header.vehicleNo}
              onChange={(e) => handleVehicleChange(e.target.value)}
              placeholder={t("কোম্পানির গাড়ি বা টাইপ করুন")}
              autoComplete="off"
            />
            {companyVehicles && companyVehicles.length > 0 && (
              <datalist id="company-vehicles-paddy">
                {companyVehicles.map((cv) => (
                  <option key={cv.id} value={cv.vehicleNo}>
                    {cv.driverName ? `${cv.vehicleNo} (${cv.driverName})` : cv.vehicleNo}
                  </option>
                ))}
              </datalist>
            )}
          </div>
          <div>
            <label className="label text-xs" htmlFor="paddy-driver-name">{t("ড্রাইভারের নাম ও মোবাইল")}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <input id="paddy-driver-name" type="text" className="input text-xs" value={header.driverName} onChange={(e) => setH("driverName", e.target.value)} placeholder={t("নাম")} />
              <input id="paddy-driver-mobile" type="text" className="input text-xs" value={header.driverMobile} onChange={(e) => setH("driverMobile", e.target.value)} placeholder={t("মোবাইল")} />
            </div>
          </div>
          <div>
            <label className="label text-xs" htmlFor="paddy-fare">{t("ট্রিপ ভাড়া (টাকা)")}</label>
            <input id="paddy-fare" type="text" inputMode="decimal" data-numeric className="input text-xs font-semibold" value={header.transportFare} onChange={(e) => setH("transportFare", e.target.value)} placeholder="০.০০" />
          </div>
        </div>
      </section>

      {/* ── ২. মাঝের অংশ: ধান এন্ট্রি ও ক্যালকুলেশন বক্স ── */}
      <section ref={entryRef} className={`rounded-lg border p-4 ${editingIndex !== null ? "border-amber-400 bg-amber-50/20" : "border-rule"}`} aria-label={t("ওজন ও দাম")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-900">
            {editingIndex !== null
              ? t("ধানের তথ্য সংশোধন (ক্রম #{n})", { n: toBnDigits(editingIndex + 1) })
              : t("ধান এন্ট্রি ও ওজন-দামের হিসাব")}{" "}
            <span className="text-xs font-normal text-slate-500">({t("১ মণ = {n} কেজি", { n: toBnDigits(KG_PER_MON) })})</span>
          </h2>
          {paddyItems.length > 0 && (
            <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 border border-sky-200">
              {t("তালিকায় {n}টি ধান যুক্ত আছে", { n: toBnDigits(paddyItems.length) })}
            </span>
          )}
        </div>

        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="product">{t("পণ্য (ধান) *")}</label>
            <SearchSelect kind="products" id="product" value={entry.product} onChange={(p) => setE("product", p)} placeholder={t("ধান — পণ্য খুঁজুন (সুমন, গুটি, ৫১ ইত্যাদি)")} currency={currency} />
          </div>
          <Field label="ধানের জাত" name="variety" hint="তালিকা থেকে বাছুন বা লিখুন">
            <input id="variety" className="input" list="paddy-varieties" maxLength={60} value={entry.variety} onChange={(e) => setE("variety", e.target.value)} placeholder={t("যেমন মিনিকেট / সুমন / গুটি")} />
            <datalist id="paddy-varieties">{PADDY_VARIETIES.map((v) => <option key={v} value={v} />)}</datalist>
          </Field>
          <Field label="আর্দ্রতা (%)" name="moisturePct" hint="তথ্যের জন্য">
            <input id="moisturePct" className="input-num" inputMode="decimal" data-numeric value={entry.moisturePct} onChange={(e) => setE("moisturePct", e.target.value)} placeholder={t("যেমন ১৪")} />
          </Field>
          {entry.product?.trackBatch && (
            <Field label="ব্যাচ / লট নং *" name="batchNo">
              <input id="batchNo" className="input" value={entry.batchNo} onChange={(e) => setE("batchNo", e.target.value)} />
            </Field>
          )}
        </div>

        <div className="mb-3 grid gap-3 rounded-md bg-ink-50 p-3 sm:grid-cols-3" id="weighbridge">
          <Field label="গাড়িসহ ওজন (কেজি)" name="vehicleGrossKg" hint="ওয়েব্রিজ স্কেল — ধান বোঝাই গাড়ি">
            <input id="vehicleGrossKg" className="input-num" inputMode="decimal" data-numeric value={entry.vehicleGrossKg} onChange={(e) => setE("vehicleGrossKg", e.target.value)} placeholder={t("যেমন ১২৫০০")} />
          </Field>
          <Field label="খালি গাড়ির ওজন (কেজি)" name="vehicleTareKg" hint="ধান নামানোর পর">
            <input id="vehicleTareKg" className="input-num" inputMode="decimal" data-numeric value={entry.vehicleTareKg} onChange={(e) => setE("vehicleTareKg", e.target.value)} placeholder={t("যেমন ৪৫০০")} />
          </Field>
          <p className="self-end pb-2 text-xs text-slate-500">{t("দুটো দিলে ধানের মোট ওজন = গাড়িসহ − খালি গাড়ি, নিজে থেকে বসবে। না দিলে নিচে মোট ওজন লিখুন।")}</p>
        </div>

        <div className="mb-3 grid gap-3 rounded-md border border-amber-200 bg-amber-50/50 p-3 sm:grid-cols-3">
          <Field label="১. ক) চটের বস্তা (সংখ্যা)" name="juteBagQty" hint="সরবরাহকারীর খালি চটের বস্তা">
            <input id="juteBagQty" className="input-num bg-white font-semibold" inputMode="numeric" data-numeric value={entry.juteBagQty} onChange={(e) => setE("juteBagQty", e.target.value.replace(/[^0-9]/g, ""))} placeholder="০" />
          </Field>
          <Field label="১. খ) প্লাস্টিক বস্তা (সংখ্যা)" name="plasticBagQty" hint="সরবরাহকারীর খালি প্লাস্টিক বস্তা">
            <input id="plasticBagQty" className="input-num bg-white font-semibold" inputMode="numeric" data-numeric value={entry.plasticBagQty} onChange={(e) => setE("plasticBagQty", e.target.value.replace(/[^0-9]/g, ""))} placeholder="০" />
          </Field>
          <div className="flex flex-col justify-center rounded-md border border-amber-300 bg-white p-2.5 shadow-2xs">
            <span className="text-xs font-semibold text-slate-700">{t("১. মোট বস্তা (স্বয়ংক্রিয়)")}</span>
            <output id="totalBags" className="text-2xl font-bold tabular-nums text-amber-900" aria-live="polite">
              {toBnDigits(entryBags)} <span className="text-sm font-normal text-slate-600">{t("টি")}</span>
            </output>
            <span className="text-[11px] text-slate-500">{t("চট")}: {toBnDigits(n(entry.juteBagQty))} + {t("প্লাস্টিক")}: {toBnDigits(n(entry.plasticBagQty))}</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="২. মোট ওজন (কেজি) *" name="grossKg" hint={wbGross !== null ? "গাড়িসহ − খালি গাড়ি (স্বয়ংক্রিয়)" : undefined}>
            {wbGross !== null
              ? <output id="grossKg" className={`${auto} block`} aria-live="polite">{formatQty(wbGross)}</output>
              : <input id="grossKg" className="input-num" inputMode="decimal" data-numeric value={entry.grossKg} onChange={(e) => setE("grossKg", e.target.value)} placeholder={t("যেমন ১০৫০")} />}
          </Field>
          <Field label="৩. ঢলতা (কেজি)" name="dhaltaKg" hint="মোট ওজন থেকে সরাসরি বাদ যাবে">
            <input id="dhaltaKg" className="input-num" inputMode="decimal" data-numeric value={entry.dhaltaKg} onChange={(e) => setE("dhaltaKg", e.target.value)} placeholder="০" />
          </Field>
          <Field label="৪. নিট ওজন (কেজি)" name="netKg" hint={fig.netKg > 0 ? `${toBnDigits(split.mon)} মণ ${formatQty(split.kg)} কেজি` : "মোট − ঢলতা"}>
            <output id="netKg" className={`${auto} block`} aria-live="polite">{formatQty(fig.netKg)}</output>
          </Field>
          <Field label="৫. মণ" name="mon" hint="নিট ÷ ৪০ (দশমিক ২ ঘর)">
            <output id="mon" className={`${auto} block`} aria-live="polite">{toBnDigits(fig.mon.toFixed(2))}</output>
          </Field>
          <Field label="৬. প্রতি মণের দর *" name="ratePerMon">
            <input id="ratePerMon" className="input-num" inputMode="decimal" data-numeric value={entry.ratePerMon} onChange={(e) => setE("ratePerMon", e.target.value)} placeholder={t("যেমন ১২৫০")} />
          </Field>
          <Field label="৭. এই ধানের মোট দাম" name="totalPrice" hint="মণ × দর" className="lg:col-span-2">
            <output id="totalPrice" className={`${auto} block text-lg text-brand-800`} aria-live="polite">{formatMoney(fig.totalPrice, currency)}</output>
          </Field>
        </div>

        {itemError && (
          <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {itemError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <button
            type="button"
            onClick={handleAddOrUpdateItem}
            className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold text-white shadow-xs transition ${
              editingIndex !== null
                ? "bg-amber-600 hover:bg-amber-700 focus-visible:outline-2 focus-visible:outline-amber-600"
                : "bg-sky-600 hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-sky-600"
            }`}
          >
            {editingIndex !== null
              ? t("✓ ধানের তথ্য আপডেট করুন")
              : t("+ ধানের তালিকায় যোগ করুন")}
          </button>
          {editingIndex !== null && (
            <button type="button" onClick={handleCancelEditRow} className="btn-secondary text-sm">
              {t("সম্পাদনা বাতিল")}
            </button>
          )}
        </div>
      </section>

      {/* ── ৩. নিচের প্রিভিউ ও রিভাইস টেবিল ── */}
      {paddyItems.length > 0 && (
        <section className="rounded-lg border border-sky-200 bg-white shadow-2xs" aria-label={t("যুক্তকৃত ধানের তালিকা")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 bg-sky-50/70 px-4 py-2.5">
            <h2 className="text-sm font-bold text-ink-900">
              {t("যুক্তকৃত ধানের তালিকা")} ({toBnDigits(paddyItems.length)} {t("টি আইটেম")})
            </h2>
            <span className="text-xs text-slate-600">{t("ভুল থাকলে 'এডিট' বা 'মুছুন' দিয়ে সংশোধন করতে পারবেন")}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th className="w-12 text-center">{t("ক্রমিক")}</th>
                  <th>{t("ধানের নাম")}</th>
                  <th className="text-right">{t("মোট বস্তা")}</th>
                  <th className="text-right">{t("মোট ওজন (কেজি)")}</th>
                  <th className="text-right">{t("ধলতা")}</th>
                  <th className="text-right">{t("নিট ওজন (কেজি)")}</th>
                  <th className="text-right">{t("মণ")}</th>
                  <th className="text-right">{t("দর")}</th>
                  <th className="text-right">{t("মোট টাকা")}</th>
                  <th className="text-center">{t("অ্যাকশন")}</th>
                </tr>
              </thead>
              <tbody>
                {paddyItems.map((it, idx) => {
                  const calc = cartSummary.items[idx];
                  const isEditing = editingIndex === idx;
                  return (
                    <tr key={it.key} className={isEditing ? "bg-amber-50/80" : undefined}>
                      <td className="text-center font-medium tabular-nums">
                        {toBnDigits(idx + 1)}
                        {isEditing && <span className="block text-[10px] font-semibold text-amber-700">{t("সম্পাদনা")}</span>}
                      </td>
                      <td>
                        <div className="font-semibold text-ink-900">{it.product?.name}</div>
                        <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                          {it.variety && <span>{t("জাত")}: {it.variety}</span>}
                          {it.moisturePct && <span>· {t("আর্দ্রতা")}: {toBnDigits(it.moisturePct)}%</span>}
                          {it.batchNo && <span>· {t("ব্যাচ")}: {it.batchNo}</span>}
                        </div>
                      </td>
                      <td className="num">
                        <span className="font-semibold">{toBnDigits(calc.totalBags)}</span>
                        {(calc.juteBagQty > 0 || calc.plasticBagQty > 0) && (
                          <span className="block whitespace-nowrap text-[11px] text-slate-500">
                            {t("চট")} {toBnDigits(calc.juteBagQty)} · {t("প্লা")} {toBnDigits(calc.plasticBagQty)}
                          </span>
                        )}
                      </td>
                      <td className="num">{formatQty(calc.grossKg)}</td>
                      <td className="num">{formatQty(calc.dhaltaKg)}</td>
                      <td className="num font-medium">{formatQty(calc.netKg)}</td>
                      <td className="num">{toBnDigits(calc.mon.toFixed(2))}</td>
                      <td className="num">{formatMoney(calc.ratePerMon, currency)}</td>
                      <td className="num font-semibold text-brand-800">{formatMoney(calc.totalPrice, currency)}</td>
                      <td className="whitespace-nowrap text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditRow(idx)}
                            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                          >
                            ✏️ {t("এডিট")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(idx)}
                            className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                          >
                            🗑️ {t("মুছুন")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-300 bg-ink-50 font-bold text-ink-900">
                  <td colSpan={2} className="text-right">{t("সর্বমোট")}</td>
                  <td className="num">
                    {toBnDigits(cartSummary.totalBags)} {t("টি")}
                    {(cartSummary.juteBagQty > 0 || cartSummary.plasticBagQty > 0) && (
                      <span className="block text-[10px] font-normal text-slate-600">
                        {t("চট")} {toBnDigits(cartSummary.juteBagQty)} + {t("প্লা")} {toBnDigits(cartSummary.plasticBagQty)}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatQty(cartSummary.grossKg)}</td>
                  <td className="num">{formatQty(cartSummary.dhaltaKg)}</td>
                  <td className="num text-ink-900">{formatQty(cartSummary.netKg)}</td>
                  <td className="num text-sky-800">{toBnDigits(cartSummary.mon.toFixed(2))}</td>
                  <td className="num text-xs font-normal text-slate-500">{paddyItems.length > 1 ? t("গড়") : ""} {formatMoney(cartSummary.ratePerMon, currency)}</td>
                  <td className="num text-base text-emerald-800">{formatMoney(cartSummary.totalPrice, currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      <FieldError name="items" />

      {/* ── ৪. চূড়ান্ত পেমেন্ট, নোট ও সংরক্ষণ সেকশন ── */}
      <section className="space-y-3 rounded-lg border border-rule bg-slate-50/50 p-4" aria-label={t("পরিশোধ")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
          <h2 className="text-sm font-semibold text-ink-900">{t("চূড়ান্ত হিসাব, পেমেন্ট ও নোট")}</h2>
          <div className="text-sm font-bold text-emerald-800">
            {t("চালানের সর্বমোট বিল")}: <span className="tabular-nums text-base">{formatMoney(cartSummary.totalPrice, currency)}</span>
          </div>
        </div>

        <Field label="নোট" name="notes" hint="গাড়ি নম্বর, ড্রাইভার বা চালানের যেকোনো বিশেষ নোট">
          <textarea id="notes" className="input min-h-[64px] bg-white" maxLength={500} value={header.notes} onChange={(e) => setH("notes", e.target.value)} placeholder={t("যেমন: ট্রাক ঢাকা মেট্রো-ট ১১-২২৩৩, ড্রাইভার রফিক")} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="লেবার খরচ (নামানো/বহন)" name="labourCost" hint={n(header.labourCost) > 0 ? "নিচের নগদ/ব্যাংক থেকে আলাদা খরচ হিসেবে পোস্ট হবে" : "না থাকলে খালি রাখুন"}>
            <input id="labourCost" className="input-num bg-white" inputMode="decimal" data-numeric value={header.labourCost} onChange={(e) => setH("labourCost", e.target.value)} placeholder="০" />
          </Field>
          {!cashPurchase && (
            <Field label="এখন পরিশোধ" name="paidAmount" hint={`বাকি থাকবে ${formatMoney(Math.max(0, cartSummary.totalPrice - paid), currency)}`}>
              <input id="paidAmount" className="input-num bg-white" inputMode="decimal" data-numeric value={header.paidAmount} onChange={(e) => setH("paidAmount", e.target.value)} placeholder="০" />
            </Field>
          )}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="cashAccountId">
              {cashPurchase ? t("পরিশোধ (নগদ ক্রয় — পুরো টাকা) *") : n(header.labourCost) > 0 ? t("পরিশোধ ও লেবার খরচের হিসাব *") : t("পরিশোধের হিসাব")}
            </label>
            <SearchableAccountSelect id="cashAccountId" scope="cash" known={cashAccounts} value={header.cashAccountId} onChange={(v) => setH("cashAccountId", v)} placeholder={t("নগদ / ব্যাংক / মোবাইল ব্যাংকিং")} currency={currency} />
            <FieldError name="cashAccountId" />
          </div>
        </div>
      </section>

      {paddyItems.length === 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {t("সংরক্ষণের আগে উপরের 'ধানের তালিকায় যোগ করুন' বাটনে চাপ দিয়ে অন্তত ১টি ধান যুক্ত করুন।")}
        </p>
      )}
      {editingIndex !== null && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          {t("একটি ধানের তথ্য সম্পাদনা চলছে — অনুগ্রহ করে 'আপডেট করুন' বা 'সম্পাদনা বাতিল' চাপুন।")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton
          disabled={!canSubmit}
          className={`btn-primary bg-emerald-600 hover:bg-emerald-700 ${!canSubmit ? "cursor-not-allowed opacity-50" : ""}`}
        >
          {t("✅ সব ধান ক্রয় সংরক্ষণ করুন")}
        </SubmitButton>
        <Link prefetch={false} href="/purchases/paddy" className="btn-secondary">{t("বাতিল")}</Link>
      </div>
    </ActionForm>
  );
}
