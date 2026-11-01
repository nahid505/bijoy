"use client";

// Recipe (BOM) form and production entry form. Quantities are in each product's base unit.
import Link from "next/link";
import { EntryDateInput } from "@/components/entry-date-input";
import { useMemo, useState } from "react";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchSelect } from "@/components/search-select";
import type { AccountOption, ProductOption, UnitOption, WarehouseOption } from "@/components/trade-parts";
import { formatQty, toBnDigits, toDateInput } from "@/lib/format";
import { batchesFor, processLoss, shareTotal, sharesBySaleValue, sharesValid, yieldPercent } from "@/lib/production";

type Line = { key: string; product: ProductOption | null; quantity: string; costShare: string; batchNo: string };
let seq = 0;
const newLine = (p: ProductOption | null = null, quantity = "", costShare = ""): Line => ({ key: `l${++seq}`, product: p, quantity, costShare, batchNo: "" });
const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtNum = (v: number) => String(Math.round(v * 1000) / 1000);

export interface RecipeLineData {
  product: ProductOption;
  quantity: number;
  costShare: number;
}
export interface RecipeData {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  inputs: RecipeLineData[];
  outputs: RecipeLineData[];
}

function useUnits(units: UnitOption[]) {
  const map = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  return (p: ProductOption | null) => (p ? map.get(p.unitId)?.name ?? "" : "");
}

/** Product table shared by both forms. */
function LineTable({
  title, hint, lines, setLines, units, outputs, showCostShare = false, currency, showStock, batches, prefix,
}: {
  title: string; hint?: string; lines: Line[]; setLines: (l: Line[]) => void; units: UnitOption[]; outputs: boolean; showCostShare?: boolean; currency: string;
  showStock?: boolean; batches?: boolean; prefix: string;
}) {
  const unitName = useUnits(units);
  const update = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    // min-w-0: a fieldset is min-content wide by default, which would widen the page on phones
    <fieldset className="min-w-0 rounded-lg border border-rule p-3">
      <legend className="px-1 text-sm font-semibold text-ink-900">{title}</legend>
      {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
      <div className="overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr><th className="w-8">#</th><th>পণ্য</th><th className="w-36 text-right">পরিমাণ</th>{showCostShare && <th className="w-32 text-right">খরচ-ভাগ %</th>}{batches && <th className="w-36">ব্যাচ নং</th>}<th className="w-10" /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const short = showStock && l.product && n(l.quantity) > l.product.stock + 1e-9;
              return (
                <tr key={l.key}>
                  <td className="text-xs text-slate-400">{toBnDigits(i + 1)}</td>
                  <td>
                    <SearchSelect kind="products" value={l.product} onChange={(p) => update(l.key, { product: p })} placeholder="পণ্য খুঁজুন — নাম, কোড, বারকোড" currency={currency} unitName={(id) => units.find((u) => u.id === id)?.name ?? ""} priceOf={(p) => p.avgCost || p.purchasePrice} ariaLabel={`${title}, সারি ${i + 1}`} />
                    {short && <p className="mt-1 text-xs text-credit">মজুদ মাত্র {formatQty(l.product!.stock)} {unitName(l.product)}</p>}
                    <FieldError name={`${prefix}.${i}.productId`} />
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <input className="input-num" inputMode="decimal" data-numeric value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label={`পরিমাণ, সারি ${i + 1}`} />
                      <span className="w-12 shrink-0 text-xs text-slate-500">{unitName(l.product)}</span>
                    </div>
                    <FieldError name={`${prefix}.${i}.quantity`} />
                  </td>
                  {showCostShare && (
                    <td><input className="input-num" inputMode="decimal" data-numeric value={l.costShare} onChange={(e) => update(l.key, { costShare: e.target.value })} aria-label={`খরচ-ভাগ %, সারি ${i + 1}`} /></td>
                  )}
                  {batches && (
                    <td>{l.product?.trackBatch ? <input className="input" value={l.batchNo} onChange={(e) => update(l.key, { batchNo: e.target.value })} placeholder={outputs ? "স্বয়ংক্রিয়" : "FEFO"} aria-label={`ব্যাচ, সারি ${i + 1}`} /> : <span className="text-xs text-slate-400">—</span>}</td>
                  )}
                  <td><button type="button" className="btn-ghost btn-sm text-credit" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} disabled={lines.length <= 1} aria-label="সারি মুছুন">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => setLines([...lines, newLine()])}>+ সারি যোগ করুন</button>
      <FieldError name={prefix} />
    </fieldset>
  );
}

/** Yield, loss and optional cost-share checks shown under forms. */
function Analysis({ inputs, outputs, unitOf, showCostShare = false }: { inputs: Line[]; outputs: Line[]; unitOf: (p: ProductOption | null) => string; showCostShare?: boolean }) {
  const main = inputs.find((l) => l.product && n(l.quantity) > 0);
  const loss = processLoss(
    inputs.filter((l) => l.product).map((l) => ({ quantity: n(l.quantity), unitId: l.product!.unitId })),
    outputs.filter((l) => l.product).map((l) => ({ quantity: n(l.quantity), unitId: l.product!.unitId })),
  );
  const shares = outputs.map((o) => ({ costShare: n(o.costShare) }));
  return (
    <div className={`grid gap-3 rounded-lg bg-ink-50 p-3 text-sm ${showCostShare ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      <div>
        <p className="text-xs font-semibold text-slate-500">ফলন (প্রধান কাঁচামালের তুলনায়)</p>
        {main ? outputs.filter((o) => o.product).map((o) => (
          <p key={o.key}>{o.product!.name}: <strong className="tabular-nums">{toBnDigits(yieldPercent(n(o.quantity), n(main.quantity)))}%</strong></p>
        )) : <p className="text-slate-400">—</p>}
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500">প্রসেস লস</p>
        {loss ? <p className={loss.quantity < 0 ? "text-credit" : ""}><strong className="tabular-nums">{formatQty(loss.quantity)} {unitOf(main?.product ?? null)}</strong> ({toBnDigits(loss.percent)}%){loss.quantity < 0 && " — উৎপাদন কাঁচামালের চেয়ে বেশি!"}</p> : <p className="text-slate-400">ভিন্ন একক — হিসাব প্রযোজ্য নয়</p>}
      </div>
      {showCostShare && (
        <div>
          <p className="text-xs font-semibold text-slate-500">খরচ-ভাগের যোগফল</p>
          <p className={sharesValid(shares) ? "text-brand-700" : "text-credit"}><strong className="tabular-nums">{toBnDigits(shareTotal(shares))}%</strong> {sharesValid(shares) ? "✓" : "(১০০% হতে হবে)"}</p>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── recipe form ─────────────────────────

export function RecipeForm({ action, units, recipe, currency }: { action: FormAction; units: UnitOption[]; recipe: RecipeData | null; currency: string }) {
  const unitOf = useUnits(units);
  const [name, setName] = useState(recipe?.name ?? "");
  const [code, setCode] = useState(recipe?.code ?? "");
  const [description, setDescription] = useState(recipe?.description ?? "");
  const [isActive, setActive] = useState(recipe?.isActive ?? true);
  const [inputs, setInputs] = useState<Line[]>(() => (recipe?.inputs.length ? recipe.inputs.map((l) => newLine(l.product, fmtNum(l.quantity))) : [newLine()]));
  const [outputs, setOutputs] = useState<Line[]>(() => (recipe?.outputs.length ? recipe.outputs.map((l) => newLine(l.product, fmtNum(l.quantity), fmtNum(l.costShare))) : [newLine(null, "", "100")]));
  const bySaleValue = () => {
    const shares = sharesBySaleValue(outputs.map((o) => ({ quantity: n(o.quantity), salePrice: o.product?.salePrice ?? 0 })));
    setOutputs(outputs.map((o, i) => ({ ...o, costShare: fmtNum(shares[i]) })));
  };
  const payload = JSON.stringify({
    name, code: code || null, description: description || null, isActive,
    inputs: inputs.filter((l) => l.product || l.quantity).map((l) => ({ productId: l.product?.id ?? "", quantity: l.quantity })),
    outputs: outputs.filter((l) => l.product || l.quantity).map((l) => ({ productId: l.product?.id ?? "", quantity: l.quantity, costShare: l.costShare || 0 })),
  });
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="রেসিপির নাম *" name="name" className="sm:col-span-2"><input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="যেমন: ধান ভাঙানো (চাল উৎপাদন)" /></Field>
        <Field label="কোড" name="code"><input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <div className="flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} /> সক্রিয়</label></div>
        <Field label="বিবরণ" name="description" className="sm:col-span-2 lg:col-span-4"><input id="description" className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <LineTable title="কাঁচামাল (প্রতি ব্যাচে)" hint="প্রথম সারির কাঁচামালটি প্রধান — উৎপাদনের সময় এর পরিমাণ দিলে বাকি সব স্বয়ংক্রিয়ভাবে হিসাব হবে।" lines={inputs} setLines={setInputs} units={units} outputs={false} currency={currency} prefix="inputs" />
      <LineTable title="উৎপাদিত পণ্য ও বাই-প্রোডাক্ট (প্রতি ব্যাচে)" hint="খরচ-ভাগ: মোট উৎপাদন ব্যয়ের কত % কোন পণ্য বহন করবে (যোগফল ১০০%)। প্রধান পণ্যে বেশি, বাই-প্রোডাক্টে কম।" lines={outputs} setLines={setOutputs} units={units} outputs showCostShare currency={currency} prefix="outputs" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={bySaleValue}>বিক্রয়মূল্য অনুযায়ী খরচ-ভাগ হিসাব করুন</button>
      </div>
      <Analysis inputs={inputs} outputs={outputs} unitOf={unitOf} showCostShare />
      <div className="flex gap-2"><SubmitButton>সংরক্ষণ করুন</SubmitButton><Link prefetch={false} href="/production/recipes" className="btn-secondary">বাতিল</Link></div>
    </ActionForm>
  );
}

// ───────────────────────── production entry ─────────────────────────

export interface ProductionDefaults {
  date: string;
  recipeId: string | null;
  warehouseId: string | null;
  reference: string;
  narration: string;
  extraCost?: number;
  costAccountId?: string;
  inputs: { product: ProductOption; quantity: number; batchNo: string | null }[];
  outputs: { product: ProductOption; quantity: number; costShare?: number; batchNo: string | null }[];
}

export function ProductionForm({
  action, units, recipes, warehouses, accounts, defaults, currency, multiWarehouse, dateLocked,
}: {
  /** no transaction:change_date permission */
  dateLocked?: boolean;
  action: FormAction; units: UnitOption[]; recipes: RecipeData[]; warehouses: WarehouseOption[]; accounts?: AccountOption[];
  defaults: ProductionDefaults | null; currency: string; multiWarehouse: boolean;
}) {
  const unitOf = useUnits(units);
  const [date, setDate] = useState(defaults?.date ?? toDateInput()); // today in Bangladesh (UTC is still "yesterday" until 6 am)
  const [recipeId, setRecipeId] = useState(defaults?.recipeId ?? "");
  const [warehouseId, setWarehouseId] = useState(defaults?.warehouseId ?? warehouses[0]?.id ?? "");
  const [reference, setReference] = useState(defaults?.reference ?? "");
  const [narration, setNarration] = useState(defaults?.narration ?? "");
  const [inputs, setInputs] = useState<Line[]>(() => (defaults?.inputs.length ? defaults.inputs.map((l) => ({ ...newLine(l.product, fmtNum(l.quantity)), batchNo: l.batchNo ?? "" })) : [newLine()]));
  const [outputs, setOutputs] = useState<Line[]>(() => (defaults?.outputs.length ? defaults.outputs.map((l) => ({ ...newLine(l.product, fmtNum(l.quantity)), batchNo: l.batchNo ?? "" })) : [newLine()]));
  const recipe = recipes.find((r) => r.id === recipeId) ?? null;
  const [mainQty, setMainQty] = useState(() => (defaults?.inputs[0] ? fmtNum(defaults.inputs[0].quantity) : ""));
  const batches = recipe ? batchesFor(recipe.inputs[0]?.quantity ?? 0, n(mainQty)) : 1;

  /** Fill every line from the recipe for the entered main-material quantity. */
  const applyRecipe = (r: RecipeData | null, qty: string) => {
    if (!r) return;
    const b = batchesFor(r.inputs[0]?.quantity ?? 0, n(qty));
    if (!(b > 0)) return;
    setInputs(r.inputs.map((l) => newLine(l.product, fmtNum(l.quantity * b))));
    setOutputs(r.outputs.map((l) => newLine(l.product, fmtNum(l.quantity * b))));
  };

  const payload = JSON.stringify({
    date, reference: reference || null, narration: narration || null, recipeId: recipeId || null, batches: batches > 0 ? batches : 1,
    warehouseId: multiWarehouse ? warehouseId || null : null, extraCost: defaults?.extraCost ?? 0, costAccountId: defaults?.costAccountId || null,
    inputs: inputs.filter((l) => l.product || l.quantity).map((l) => ({ productId: l.product?.id ?? "", quantity: l.quantity, batchNo: l.batchNo || null })),
    outputs: outputs.filter((l) => l.product || l.quantity).map((l) => ({ productId: l.product?.id ?? "", quantity: l.quantity, costShare: 0, batchNo: l.batchNo || null, expiryDate: null })),
  });

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="তারিখ *" name="date"><EntryDateInput id="date" value={date} onChange={setDate} locked={dateLocked} /></Field>
        <Field label="রেসিপি (BOM)" name="recipeId">
          <select id="recipeId" className="input" value={recipeId} onChange={(e) => { setRecipeId(e.target.value); applyRecipe(recipes.find((r) => r.id === e.target.value) ?? null, mainQty); }}>
            <option value="">— রেসিপি ছাড়া (হাতে লিখুন) —</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        {recipe && (
          <Field label={`${recipe.inputs[0]?.product.name ?? "প্রধান কাঁচামাল"} এর পরিমাণ (${unitOf(recipe.inputs[0]?.product ?? null)})`} name="mainQty" hint={batches > 0 ? `রেসিপির ${toBnDigits(batches)} ব্যাচ` : "পরিমাণ দিন"}>
            <input id="mainQty" className="input-num" inputMode="decimal" data-numeric value={mainQty} onChange={(e) => { setMainQty(e.target.value); applyRecipe(recipe, e.target.value); }} placeholder={`যেমন ${toBnDigits(1000)}`} />
          </Field>
        )}
        {multiWarehouse && warehouses.length > 1 && (
          <Field label="গুদাম" name="warehouseId">
            <select id="warehouseId" className="input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </Field>
        )}
        <Field label="রেফারেন্স" name="reference"><input id="reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="যেমন লট / শিফট নং" /></Field>
        <Field label="মন্তব্য" name="narration" className="sm:col-span-2 lg:col-span-3"><input id="narration" className="input" value={narration} onChange={(e) => setNarration(e.target.value)} /></Field>
      </div>

      <LineTable title="ব্যবহৃত কাঁচামাল (স্টক থেকে কমবে)" lines={inputs} setLines={setInputs} units={units} outputs={false} currency={currency} showStock batches prefix="inputs" />
      <LineTable title="উৎপাদিত পণ্য ও বাই-প্রোডাক্ট (স্টকে যোগ হবে)" hint="প্রকৃত ওজন/পরিমাণ লিখুন — রেসিপির হিসাব থেকে কম-বেশি হতে পারে।" lines={outputs} setLines={setOutputs} units={units} outputs currency={currency} batches prefix="outputs" />

      <Analysis inputs={inputs} outputs={outputs} unitOf={unitOf} />

      <div className="flex gap-2"><SubmitButton>উৎপাদন সংরক্ষণ করুন</SubmitButton><Link prefetch={false} href="/production" className="btn-secondary">বাতিল</Link></div>
    </ActionForm>
  );
}
