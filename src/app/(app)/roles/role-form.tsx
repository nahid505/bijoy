"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { DEPOT_PERMISSIONS, PERMISSION_GROUPS, RICE_MILL_PERMISSIONS } from "@/lib/permissions";
import { featureDef, ownerFeature } from "@/lib/features";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";

type Group = (typeof PERMISSION_GROUPS)[number];
const isDepotGroup = (g: Group) => "depotOnly" in g && g.depotOnly;
const isMillGroup = (g: Group) => "module" in g && g.module === "RICE_MILL";

/** Card icon of each permission group. */
const ICONS: Record<string, string> = {
  "ড্যাশবোর্ড ও রিপোর্ট": "📊",
  "বিক্রয় ও বিক্রয় ফেরত": "🧾",
  "ক্রয় ও ক্রয় ফেরত": "🛒",
  "রিসিপ্ট, পেমেন্ট ও জার্নাল": "💳",
  "সাধারণ অনুমতি (লেনদেন)": "📅",
  "হিসাব (লেজার)": "📒",
  "পণ্য ও মজুদ": "📦",
  "কাস্টমার ও সরবরাহকারী": "👥",
  "বেতন (Payroll)": "💰",
  "এসএমএস": "✉️",
  "প্রশাসন": "🛡️",
  "উৎপাদন (রেসিপি / BOM)": "🏭",
  "অটো রাইস মিল ব্যবস্থাপনা": "🌾",
  "ডিপো ব্যবস্থাপনা": "🏬",
  "সাবস্ক্রিপশন ও বিলিং": "📄",
};

export function RoleForm({
  action,
  defaults,
  readOnly,
  offFeatures = [],
  depot = false,
  riceMill = false,
}: {
  action: FormAction;
  defaults?: { name: string; description: string | null; permissions: string[] };
  readOnly?: boolean;
  /** features switched off in this business: their permissions are shown but cannot be changed */
  offFeatures?: string[];
  /** depot business: the "ডিপো ব্যবস্থাপনা" group is shown (and offered as a depot-only preset) */
  depot?: boolean;
  /** rice-mill business: the "অটো রাইস মিল ব্যবস্থাপনা" group is shown (and offered as a mill-only preset) */
  riceMill?: boolean;
}) {
  const all = defaults?.permissions.includes("*") ?? false;
  const box = useRef<HTMLDivElement>(null);
  const groups = PERMISSION_GROUPS.filter((g) => (!isDepotGroup(g) || depot) && (!isMillGroup(g) || riceMill));
  const editable = !readOnly && !all;
  // tick exactly the given keys (and nothing else); switched-off features stay as they are
  const tickOnly = (keys: readonly string[]) => {
    box.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox][name="permissions"]').forEach((c) => {
      c.checked = keys.includes(c.value);
    });
    box.current?.dispatchEvent(new Event("change", { bubbles: true })); // the "select all" boxes follow
  };
  return (
    <ActionForm action={action}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="রোলের নাম *" name="name">
          <input id="name" name="name" defaultValue={defaults?.name} className="input" required disabled={readOnly} />
        </Field>
        <Field label="বিবরণ" name="description">
          <input id="description" name="description" defaultValue={defaults?.description ?? ""} className="input" disabled={readOnly} />
        </Field>
      </div>

      <div ref={box}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="label mb-0">অনুমতিসমূহ</p>
          {editable && <SelectedCount box={box} />}
          {riceMill && editable && (
            <button type="button" id="rice-mill-preset" className="btn-secondary ml-auto text-xs" onClick={() => tickOnly(RICE_MILL_PERMISSIONS)} title="শুধু অটো রাইস মিলের অনুমতি — ধান ক্রয়, মিলিং, স্টক ও বিক্রয়">
              🌾 শুধু রাইস মিল
            </button>
          )}
          {depot && editable && (
            <button type="button" id="depot-preset" className={`btn-secondary text-xs ${riceMill ? "" : "ml-auto"}`} onClick={() => tickOnly(DEPOT_PERMISSIONS)} title="শুধু ডিপো অনুমতি — সাধারণ হিসাব, লেজার, ভাউচার, লাভ-ক্ষতি ও সেটিং বাদ">
              🏬 শুধু ডিপো (ডিপো হিসাবরক্ষক)
            </button>
          )}
        </div>
        {all && <p className="mb-3 text-sm text-brand-700">এই রোলের সব অনুমতি আছে (সিস্টেম অ্যাডমিন)।</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => {
            const depotGroup = isDepotGroup(g);
            const millGroup = isMillGroup(g);
            const wide = depotGroup || millGroup;
            const keys = g.permissions.map((p) => p.key as string);
            const tone = depotGroup ? "border-amber-300 bg-amber-50/40" : millGroup ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white";
            return (
              <fieldset
                key={g.label}
                id={depotGroup ? "depot-permissions" : millGroup ? "rice-mill-permissions" : undefined}
                data-group={g.label}
                className={`perm-card min-w-0 rounded-xl border shadow-sm ${tone} ${wide ? "md:col-span-2" : ""}`}
              >
                <legend className="sr-only">{g.label}</legend>
                <div className={`flex flex-wrap items-center gap-2 rounded-t-xl border-b px-4 py-2.5 ${depotGroup ? "border-amber-200 bg-amber-100/60" : millGroup ? "border-emerald-200 bg-emerald-100/60" : "border-slate-100 bg-slate-50"}`}>
                  <span aria-hidden className="text-lg leading-none">{ICONS[g.label] ?? "🔑"}</span>
                  <span className="text-sm font-semibold text-slate-800" aria-hidden>{g.label}</span>
                  <GroupCount box={box} keys={keys} all={all} />
                  {editable && (
                    <GroupSelectAll
                      box={box}
                      keys={keys}
                      id={depotGroup ? "depot-select-all" : millGroup ? "rice-mill-select-all" : undefined}
                      label={depotGroup ? "ডিপো ব্যবস্থাপনার সব অনুমতি দিন (Select All)" : millGroup ? "রাইস মিলের সব অনুমতি দিন (Select All)" : "সব"}
                      strong={wide}
                    />
                  )}
                </div>
                <div className="p-4">
                  {depotGroup && (
                    <p className="mb-3 text-xs text-slate-600">শুধু এই গ্রুপের অনুমতি দিলে ব্যবহারকারী লগইন করে কেবল ডিপো ড্যাশবোর্ড ও &quot;ডিপো ব্যবস্থাপনা&quot; মেনু দেখবেন — সাধারণ লেনদেন, লেজার, ভাউচার, লাভ-ক্ষতি ও সেটিং দেখা যাবে না। প্রতিটি মেনু ও পেজ শুধু তার অনুমতি থাকলেই খোলে।</p>
                  )}
                  {millGroup && (
                    <p className="mb-3 text-xs text-slate-600">অটো রাইস মিল মেনুর পেজগুলো এই অনুমতিতে খোলে — সাধারণ ক্রয়, উৎপাদন, স্টক ও বিক্রয়ের অনুমতি ছাড়াও। ডেইলি ধান ভাঙানো হিসাব দেখাতে &quot;ড্যাশবোর্ড ও রিপোর্ট&quot; কার্ডের অনুমতি দিন।</p>
                  )}
                  <div className={wide ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}>
                    {g.permissions.map((p) => {
                      const owner = ownerFeature(p.key);
                      const off = !!owner && offFeatures.includes(owner);
                      const checked = all || !!defaults?.permissions.includes(p.key);
                      return (
                        <label key={p.key} className={`flex items-start gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-slate-50 ${off ? "text-slate-400" : ""}`}>
                          <input type="checkbox" className="mt-0.5" name={off ? undefined : "permissions"} value={p.key} defaultChecked={checked} disabled={readOnly || off} />
                          {/* a grant of a switched-off feature is kept when the role is saved */}
                          {off && checked && !all && <input type="hidden" name="permissions" value={p.key} />}
                          {"hint" in p ? (
                            <span className="min-w-0">
                              {p.label}
                              <span className="block text-xs text-slate-500">{p.hint}</span>
                            </span>
                          ) : <span className="min-w-0">{p.label}</span>}
                          {off && <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-500" title={featureDef(owner!).nameBn}>ফিচার বন্ধ</span>}
                          <code className="ml-auto shrink-0 pl-2 text-[11px] text-slate-400" data-keep-lang>{p.key}</code>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        {!readOnly && <SubmitButton>সংরক্ষণ করুন</SubmitButton>}
        <Link prefetch={false} href="/roles" className="btn-secondary">{readOnly ? "ফিরে যান" : "বাতিল"}</Link>
      </div>
    </ActionForm>
  );
}

const permissionBoxes = (box: RefObject<HTMLDivElement | null>) => [...(box.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox][name="permissions"]') ?? [])];

/** Re-reads the ticks whenever a box in the form changes. */
function useTicks<T>(box: RefObject<HTMLDivElement | null>, read: () => T, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sync = () => setValue(read());
    sync();
    const el = box.current;
    el?.addEventListener("change", sync);
    return () => el?.removeEventListener("change", sync);
  }, [box, read]);
  return value;
}

/** "১২টি নির্বাচিত" — every ticked permission in the form. */
function SelectedCount({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const read = useCallback(() => permissionBoxes(box).filter((c) => c.checked).length, [box]);
  const n = useTicks(box, read, 0);
  return <span id="perm-selected" className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{n} <span>নির্বাচিত</span></span>;
}

/** "৩/৫" — ticked / all permissions of one card. */
function GroupCount({ box, keys, all }: { box: RefObject<HTMLDivElement | null>; keys: string[]; all: boolean }) {
  const read = useCallback(() => permissionBoxes(box).filter((c) => keys.includes(c.value) && c.checked).length, [box, keys]);
  const n = useTicks(box, read, all ? keys.length : 0);
  return (
    <span className={`perm-count rounded-full px-2 py-0.5 text-[11px] font-medium ${n === keys.length ? "bg-emerald-100 text-emerald-700" : n ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500"}`}>
      {all ? keys.length : n}/{keys.length}
    </span>
  );
}

/** Master checkbox of a permission group: ticks / clears the whole group; half-ticked (indeterminate) when only some are on. */
function GroupSelectAll({ box, keys, label, id, strong }: { box: RefObject<HTMLDivElement | null>; keys: string[]; label: string; id?: string; strong?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const boxes = useCallback(() => permissionBoxes(box).filter((c) => keys.includes(c.value)), [box, keys]);
  const read = useCallback((): "all" | "some" | "none" => {
    const list = boxes();
    const on = list.filter((c) => c.checked).length;
    return on === 0 ? "none" : on === list.length ? "all" : "some";
  }, [boxes]);
  const state = useTicks(box, read, "none");
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <label className={`ml-auto flex items-center gap-1.5 text-xs ${strong ? "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink-900 shadow-sm" : "text-slate-600"}`}>
      <input
        ref={ref}
        type="checkbox"
        id={id}
        className="perm-select-all"
        checked={state === "all"}
        onChange={(e) => {
          for (const c of boxes()) if (!c.disabled) c.checked = e.target.checked;
          box.current?.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      />
      {label}
    </label>
  );
}
