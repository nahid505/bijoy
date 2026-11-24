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

type Line = {
  key: string;
  product: ProductOption | null;
  quantity: string;
  costShare: string;
  batchNo: string;
  emptyBagProductId?: string;
  bagSizeKg?: string;
  bagCount?: string;
};
let seq = 0;
const newLine = (
  p: ProductOption | null = null,
  quantity = "",
  costShare = "",
  emptyBagProductId = "NONE",
  bagSizeKg = "",
  bagCount = "",
): Line => ({
  key: `l${++seq}`,
  product: p,
  quantity,
  costShare,
  batchNo: "",
  emptyBagProductId,
  bagSizeKg,
  bagCount,
});
const n = (v?: string | number | null) => (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtNum = (v: number) => String(Math.round(v * 1000) / 1000);

export function defaultBagForProduct(
  p: ProductOption | null,
  packagingBags: PackagingBagOption[],
): { emptyBagProductId: string; bagSizeKg: string } {
  if (!p) return { emptyBagProductId: "NONE", bagSizeKg: "" };
  const name = p.name.toLowerCase();
  if (name.includes("তুষ") || name.includes("ভুষি") || name.includes("husk")) {
    return { emptyBagProductId: "NONE", bagSizeKg: "" };
  }
  if (name.includes("ব্রান") || name.includes("কুঁড়া") || name.includes("bran")) {
    const bag55 =
      packagingBags.find((b) => b.capacityKg === 55) ??
      packagingBags.find((b) => b.name.includes("ব্রান")) ??
      packagingBags.find((b) => b.capacityKg === 50);
    if (bag55) return { emptyBagProductId: bag55.productId, bagSizeKg: String(bag55.capacityKg) };
  }
  if (name.includes("২৫") || name.includes("25")) {
    const bag25 = packagingBags.find((b) => b.capacityKg === 25);
    if (bag25) return { emptyBagProductId: bag25.productId, bagSizeKg: "25" };
  }
  const bag50 = packagingBags.find((b) => b.capacityKg === 50) ?? packagingBags[0];
  if (bag50) return { emptyBagProductId: bag50.productId, bagSizeKg: String(bag50.capacityKg) };
  return { emptyBagProductId: "NONE", bagSizeKg: "" };
}

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
  title, hint, lines, setLines, units, outputs, showCostShare = false, currency, showStock, batches, prefix, packagingBags,
}: {
  title: string; hint?: string; lines: Line[]; setLines: (l: Line[]) => void; units: UnitOption[]; outputs: boolean; showCostShare?: boolean; currency: string;
  showStock?: boolean; batches?: boolean; prefix: string; packagingBags?: PackagingBagOption[];
}) {
  const unitName = useUnits(units);
  const update = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const isMultiBagOutput = Boolean(outputs && !showCostShare && packagingBags !== undefined);

  return (
    // min-w-0: a fieldset is min-content wide by default, which would widen the page on phones
    <fieldset className="min-w-0 rounded-lg border border-rule p-3">
      <legend className="px-1 text-sm font-semibold text-ink-900">{title}</legend>
      {hint && <p className="px-1 text-xs text-slate-500 mb-2">{hint}</p>}
      <div className="overflow-x-auto">
        <table className={`table ${isMultiBagOutput ? "min-w-[840px]" : "min-w-[640px]"}`}>
          <thead>
            {isMultiBagOutput ? (
              <tr>
                <th className="w-8">#</th>
                <th className="min-w-[170px]">উৎপাদিত পণ্য</th>
                <th className="w-64">খালি বস্তার ধরন (প্যাকিং)</th>
                <th className="w-24 text-right">সাইজ (কেজি)</th>
                <th className="w-24 text-right">বস্তা সংখ্যা</th>
                <th className="w-32 text-right">মোট পরিমাণ</th>
                {batches && <th className="w-28">ব্যাচ নং</th>}
                <th className="w-10" />
              </tr>
            ) : (
              <tr>
                <th className="w-8">#</th>
                <th>পণ্য</th>
                <th className="w-36 text-right">পরিমাণ</th>
                {showCostShare && <th className="w-32 text-right">খরচ-ভাগ %</th>}
                {batches && <th className="w-36">ব্যাচ নং</th>}
                <th className="w-10" />
              </tr>
            )}
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const short = showStock && l.product && n(l.quantity) > l.product.stock + 1e-9;
              if (isMultiBagOutput) {
                const selectedBag = packagingBags?.find((b) => b.productId === l.emptyBagProductId);
                const isShortage = selectedBag && n(l.bagCount) > selectedBag.stock;
                return (
                  <tr key={l.key}>
                    <td className="text-xs text-slate-400">{toBnDigits(i + 1)}</td>
                    <td>
                      <SearchSelect
                        kind="products"
                        value={l.product}
                        onChange={(p) => {
                          const patch: Partial<Line> = { product: p };
                          if (packagingBags && (!l.emptyBagProductId || l.emptyBagProductId === "NONE")) {
                            const def = defaultBagForProduct(p, packagingBags);
                            patch.emptyBagProductId = def.emptyBagProductId;
                            patch.bagSizeKg = def.bagSizeKg;
                            const cap = Number(def.bagSizeKg) || 0;
                            if (cap > 0 && n(l.quantity) > 0) {
                              patch.bagCount = String(Math.round(n(l.quantity) / cap));
                            }
                          }
                          update(l.key, patch);
                        }}
                        placeholder="পণ্য খুঁজুন — নাম, কোড, বারকোড"
                        currency={currency}
                        unitName={(id) => units.find((u) => u.id === id)?.name ?? ""}
                        priceOf={(p) => p.avgCost || p.purchasePrice}
                        ariaLabel={`${title}, সারি ${i + 1}`}
                      />
                      <FieldError name={`${prefix}.${i}.productId`} />
                    </td>
                    <td>
                      <select
                        className="input text-xs font-semibold py-1 bg-white text-slate-800"
                        value={l.emptyBagProductId ?? "NONE"}
                        onChange={(e) => {
                          const bagId = e.target.value;
                          if (bagId === "NONE") {
                            update(l.key, { emptyBagProductId: "NONE", bagSizeKg: "", bagCount: "" });
                          } else {
                            const bag = packagingBags?.find((b) => b.productId === bagId);
                            const cap = bag ? bag.capacityKg : 50;
                            const patch: Partial<Line> = {
                              emptyBagProductId: bagId,
                              bagSizeKg: String(cap),
                            };
                            if (n(l.bagCount) > 0) {
                              patch.quantity = fmtNum(n(l.bagCount) * cap);
                            } else if (n(l.quantity) > 0 && cap > 0) {
                              patch.bagCount = String(Math.round(n(l.quantity) / cap));
                            }
                            update(l.key, patch);
                          }
                        }}
                        aria-label={`খালি বস্তা, সারি ${i + 1}`}
                      >
                        <option value="NONE">🚫 খোলা / বস্তা ছাড়া</option>
                        {packagingBags?.map((bag) => (
                          <option key={bag.productId} value={bag.productId}>
                            {bag.name} ({toBnDigits(bag.capacityKg)} কেজি) — মজুদ: {toBnDigits(bag.stock)} {bag.unit}
                          </option>
                        ))}
                      </select>
                      {l.emptyBagProductId && l.emptyBagProductId !== "NONE" && selectedBag && (
                        <div className="mt-1 flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">মজুদ: {toBnDigits(selectedBag.stock)} {selectedBag.unit}</span>
                          {isShortage && (
                            <span className="font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.2">
                              ⚠️ ঘাটতি
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        className="input-num text-xs"
                        inputMode="decimal"
                        data-numeric
                        disabled={!l.emptyBagProductId || l.emptyBagProductId === "NONE"}
                        value={l.bagSizeKg ?? ""}
                        onChange={(e) => {
                          const cap = n(e.target.value);
                          const patch: Partial<Line> = { bagSizeKg: e.target.value };
                          if (n(l.bagCount) > 0 && cap > 0) {
                            patch.quantity = fmtNum(n(l.bagCount) * cap);
                          } else if (n(l.quantity) > 0 && cap > 0) {
                            patch.bagCount = String(Math.round(n(l.quantity) / cap));
                          }
                          update(l.key, patch);
                        }}
                        placeholder="কেজি"
                        aria-label={`বস্তার সাইজ, সারি ${i + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input-num text-xs font-bold text-ink-900"
                        inputMode="numeric"
                        data-numeric
                        disabled={!l.emptyBagProductId || l.emptyBagProductId === "NONE"}
                        value={l.bagCount ?? ""}
                        onChange={(e) => {
                          const count = n(e.target.value);
                          const cap = n(l.bagSizeKg);
                          const patch: Partial<Line> = { bagCount: e.target.value };
                          if (cap > 0) {
                            patch.quantity = fmtNum(count * cap);
                          }
                          update(l.key, patch);
                        }}
                        placeholder="বস্তা"
                        aria-label={`বস্তা সংখ্যা, সারি ${i + 1}`}
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <input
                          className="input-num font-bold text-xs"
                          inputMode="decimal"
                          data-numeric
                          value={l.quantity}
                          onChange={(e) => {
                            const q = n(e.target.value);
                            const cap = n(l.bagSizeKg);
                            const patch: Partial<Line> = { quantity: e.target.value };
                            if (cap > 0 && l.emptyBagProductId && l.emptyBagProductId !== "NONE") {
                              patch.bagCount = String(Math.round(q / cap));
                            }
                            update(l.key, patch);
                          }}
                          aria-label={`মোট পরিমাণ, সারি ${i + 1}`}
                        />
                        <span className="w-10 shrink-0 text-xs text-slate-500">{unitName(l.product)}</span>
                      </div>
                      <FieldError name={`${prefix}.${i}.quantity`} />
                    </td>
                    {batches && (
                      <td>
                        {l.product?.trackBatch ? (
                          <input
                            className="input text-xs"
                            value={l.batchNo}
                            onChange={(e) => update(l.key, { batchNo: e.target.value })}
                            placeholder="স্বয়ংক্রিয়"
                            aria-label={`ব্যাচ, সারি ${i + 1}`}
                          />
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-credit"
                        onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                        disabled={lines.length <= 1}
                        aria-label="সারি মুছুন"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              }

              // Standard Line (Raw materials or recipe lines)
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
      <button
        type="button"
        className="btn-secondary btn-sm mt-2"
        onClick={() => {
          if (isMultiBagOutput && packagingBags && packagingBags.length > 0) {
            const p = packagingBags[0];
            setLines([...lines, newLine(null, "", "", p.productId, String(p.capacityKg), "")]);
          } else {
            setLines([...lines, newLine()]);
          }
        }}
      >
        + সারি যোগ করুন
      </button>
      <FieldError name={prefix} />

      {/* খালি বস্তা সমন্বয় সারাংশ কার্ড (Multi-Bag Consumption Summary) */}
      {isMultiBagOutput && packagingBags && packagingBags.length > 0 && (
        <div className="mt-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/90 p-3 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
              <span>🎒</span>
              <span>খালি বস্তা সমন্বয় সারাংশ (স্টক থেকে অটো কাটা হবে):</span>
            </span>
          </div>
          {(() => {
            const bagTotals = new Map<string, number>();
            for (const line of lines) {
              if (line.emptyBagProductId && line.emptyBagProductId !== "NONE" && n(line.bagCount) > 0) {
                bagTotals.set(
                  line.emptyBagProductId,
                  (bagTotals.get(line.emptyBagProductId) ?? 0) + n(line.bagCount),
                );
              }
            }
            if (bagTotals.size === 0) {
              return (
                <p className="text-xs text-slate-600">
                  ℹ️ কোনো খালি বস্তা নির্বাচন করা হয়নি অথবা বস্তা সংখ্যা শূন্য (সব খোলা/বস্তা ছাড়া)।
                </p>
              );
            }
            return (
              <div className="flex flex-wrap items-center gap-2">
                {Array.from(bagTotals.entries()).map(([bagProdId, totalNeeded]) => {
                  const bag = packagingBags.find((b) => b.productId === bagProdId);
                  if (!bag) return null;
                  const isShort = totalNeeded > bag.stock;
                  return (
                    <div
                      key={bagProdId}
                      className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs border font-medium ${
                        isShort
                          ? "bg-red-50 text-red-900 border-red-300"
                          : "bg-white text-slate-800 border-amber-200/80 shadow-2xs"
                      }`}
                    >
                      <span className="font-bold">{bag.name}</span>
                      <span className="text-slate-500">({toBnDigits(bag.capacityKg)} কেজি):</span>
                      <span className="font-extrabold text-ink-900 bg-amber-100/80 px-1.5 py-0.2 rounded">
                        {toBnDigits(totalNeeded)} টি
                      </span>
                      <span
                        className={
                          isShort
                            ? "text-red-700 font-bold ml-1"
                            : "text-emerald-700 text-[11px] ml-1 font-semibold"
                        }
                      >
                        {isShort
                          ? `(⚠️ ঘাটতি! মজুদ আছে মাত্র ${toBnDigits(bag.stock)} টি)`
                          : `(মজুদ: ${toBnDigits(bag.stock)} টি ✓)`}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
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

export interface PackagingBagOption {
  id: string;
  productId: string;
  name: string;
  code: string | null;
  capacityKg: number;
  stock: number;
  unit: string;
}

export interface ProductionDefaults {
  date: string;
  recipeId: string | null;
  warehouseId: string | null;
  reference: string;
  narration: string;
  extraCost?: number;
  costAccountId?: string;
  bagProductId?: string | null;
  bagWeightKg?: number;
  inputs: { product: ProductOption; quantity: number; batchNo: string | null }[];
  outputs: {
    product: ProductOption;
    quantity: number;
    costShare?: number;
    batchNo: string | null;
    emptyBagProductId?: string | null;
    bagSizeKg?: number | null;
    bagCount?: number | null;
  }[];
}

export function ProductionForm({
  action, units, recipes, warehouses, accounts, defaults, currency, multiWarehouse, dateLocked, packagingBags = [],
}: {
  /** no transaction:change_date permission */
  dateLocked?: boolean;
  action: FormAction; units: UnitOption[]; recipes: RecipeData[]; warehouses: WarehouseOption[]; accounts?: AccountOption[];
  defaults: ProductionDefaults | null; currency: string; multiWarehouse: boolean;
  packagingBags?: PackagingBagOption[];
}) {
  const unitOf = useUnits(units);
  const [date, setDate] = useState(defaults?.date ?? toDateInput()); // today in Bangladesh (UTC is still "yesterday" until 6 am)
  const [recipeId, setRecipeId] = useState(defaults?.recipeId ?? "");
  const [warehouseId, setWarehouseId] = useState(defaults?.warehouseId ?? warehouses[0]?.id ?? "");
  const [reference, setReference] = useState(defaults?.reference ?? "");
  const [narration, setNarration] = useState(defaults?.narration ?? "");
  const [inputs, setInputs] = useState<Line[]>(() => (defaults?.inputs.length ? defaults.inputs.map((l) => ({ ...newLine(l.product, fmtNum(l.quantity)), batchNo: l.batchNo ?? "" })) : [newLine()]));
  const [outputs, setOutputs] = useState<Line[]>(() => {
    if (defaults?.outputs.length) {
      return defaults.outputs.map((l) => {
        const def = defaultBagForProduct(l.product, packagingBags);
        const bagId = l.emptyBagProductId ?? def.emptyBagProductId;
        const bagSize = l.bagSizeKg ? String(l.bagSizeKg) : def.bagSizeKg;
        const cap = Number(bagSize) || 0;
        const count = l.bagCount ? String(l.bagCount) : (cap > 0 && l.quantity > 0 ? String(Math.round(l.quantity / cap)) : "");
        return {
          ...newLine(l.product, fmtNum(l.quantity), fmtNum(l.costShare ?? 0), bagId, bagSize, count),
          batchNo: l.batchNo ?? "",
        };
      });
    }
    const def = defaultBagForProduct(null, packagingBags);
    return [newLine(null, "", "", def.emptyBagProductId, def.bagSizeKg, "")];
  });
  const recipe = recipes.find((r) => r.id === recipeId) ?? null;
  const [mainQty, setMainQty] = useState(() => (defaults?.inputs[0] ? fmtNum(defaults.inputs[0].quantity) : ""));
  const batches = recipe ? batchesFor(recipe.inputs[0]?.quantity ?? 0, n(mainQty)) : 1;

  /** Fill every line from the recipe for the entered main-material quantity. */
  const applyRecipe = (r: RecipeData | null, qty: string) => {
    if (!r) return;
    const b = batchesFor(r.inputs[0]?.quantity ?? 0, n(qty));
    if (!(b > 0)) return;
    setInputs(r.inputs.map((l) => newLine(l.product, fmtNum(l.quantity * b))));
    setOutputs(r.outputs.map((l) => {
      const q = l.quantity * b;
      const def = defaultBagForProduct(l.product, packagingBags);
      const cap = Number(def.bagSizeKg) || 0;
      const count = cap > 0 && q > 0 ? String(Math.round(q / cap)) : "";
      return {
        ...newLine(l.product, fmtNum(q), fmtNum(l.costShare), def.emptyBagProductId, def.bagSizeKg, count),
      };
    }));
  };

  const payload = JSON.stringify({
    date, reference: reference || null, narration: narration || null, recipeId: recipeId || null, batches: batches > 0 ? batches : 1,
    warehouseId: multiWarehouse ? warehouseId || null : null, extraCost: defaults?.extraCost ?? 0, costAccountId: defaults?.costAccountId || null,
    bagProductId: null,
    bagWeightKg: 0,
    inputs: inputs.filter((l) => l.product || l.quantity).map((l) => ({ productId: l.product?.id ?? "", quantity: l.quantity, batchNo: l.batchNo || null })),
    outputs: outputs.filter((l) => l.product || l.quantity).map((l) => ({
      productId: l.product?.id ?? "",
      quantity: l.quantity,
      costShare: 0,
      batchNo: l.batchNo || null,
      expiryDate: null,
      emptyBagProductId: l.emptyBagProductId === "NONE" ? null : (l.emptyBagProductId || null),
      bagSizeKg: l.bagSizeKg ? Number(l.bagSizeKg) : null,
      bagCount: l.bagCount ? Math.round(Number(l.bagCount)) : 0,
    })),
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

      <LineTable
        title="উৎপাদিত পণ্য ও বাই-প্রোডাক্ট (স্টকে যোগ হবে)"
        hint="প্রতি পণ্যের জন্য খালি বস্তা ও বস্তার সাইজ নির্বাচন করুন — বস্তা সংখ্যা দিলে মোট কেজি অথবা মোট কেজি দিলে বস্তা সংখ্যা স্বয়ংক্রিয়ভাবে হিসাব হবে।"
        lines={outputs}
        setLines={setOutputs}
        units={units}
        outputs
        currency={currency}
        batches
        prefix="outputs"
        packagingBags={packagingBags}
      />

      <Analysis inputs={inputs} outputs={outputs} unitOf={unitOf} />

      <div className="flex gap-2"><SubmitButton>উৎপাদন সংরক্ষণ করুন</SubmitButton><Link prefetch={false} href="/production" className="btn-secondary">বাতিল</Link></div>
    </ActionForm>
  );
}
