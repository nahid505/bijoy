"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { DEPOT_PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { featureDef, ownerFeature } from "@/lib/features";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";

export function RoleForm({
  action,
  defaults,
  readOnly,
  offFeatures = [],
  depot = false,
}: {
  action: FormAction;
  defaults?: { name: string; description: string | null; permissions: string[] };
  readOnly?: boolean;
  /** features switched off in this business: their permissions are shown but cannot be changed */
  offFeatures?: string[];
  /** depot business: the "ডিপো ব্যবস্থাপনা" group is shown (and offered as a depot-only preset) */
  depot?: boolean;
}) {
  const all = defaults?.permissions.includes("*") ?? false;
  const box = useRef<HTMLDivElement>(null);
  const groups = PERMISSION_GROUPS.filter((g) => !("depotOnly" in g && g.depotOnly) || depot);
  // tick exactly the given keys (and nothing else); switched-off features stay as they are
  const tickOnly = (keys: readonly string[]) => {
    box.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox][name="permissions"]').forEach((c) => {
      c.checked = keys.includes(c.value);
    });
    box.current?.dispatchEvent(new Event("change", { bubbles: true })); // the "select all" box follows
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="label mb-0">অনুমতিসমূহ</p>
          {depot && !readOnly && !all && (
            <button type="button" id="depot-preset" className="btn-secondary ml-auto text-xs" onClick={() => tickOnly(DEPOT_PERMISSIONS)} title="শুধু ডিপো অনুমতি — সাধারণ হিসাব, লেজার, ভাউচার, লাভ-ক্ষতি ও সেটিং বাদ">
              🏬 শুধু ডিপো (ডিপো হিসাবরক্ষক)
            </button>
          )}
        </div>
        {all && <p className="mb-3 text-sm text-brand-700">এই রোলের সব অনুমতি আছে (সিস্টেম অ্যাডমিন)।</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => {
            const depotGroup = "depotOnly" in g && g.depotOnly;
            return (
              <fieldset key={g.label} id={depotGroup ? "depot-permissions" : undefined} className={`rounded-lg border p-4 ${depotGroup ? "border-amber-300 bg-amber-50/40 md:col-span-2" : "border-slate-200"}`}>
                <legend className="px-1 text-sm font-semibold text-slate-700">
                  {depotGroup ? "🏬 " : ""}{g.label}
                </legend>
                {depotGroup && (
                  <div className="mb-3 space-y-2">
                    {!readOnly && !all && <GroupSelectAll box={box} keys={g.permissions.map((p) => p.key)} label="ডিপো ব্যবস্থাপনার সব অনুমতি দিন (Select All)" />}
                    <p className="text-xs text-slate-600">শুধু এই গ্রুপের অনুমতি দিলে ব্যবহারকারী লগইন করে কেবল ডিপো ড্যাশবোর্ড ও &quot;ডিপো ব্যবস্থাপনা&quot; মেনু দেখবেন — সাধারণ লেনদেন, লেজার, ভাউচার, লাভ-ক্ষতি ও সেটিং দেখা যাবে না। প্রতিটি মেনু ও পেজ শুধু তার অনুমতি থাকলেই খোলে।</p>
                  </div>
                )}
                <div className={depotGroup ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}>
                  {g.permissions.map((p) => {
                    const owner = ownerFeature(p.key);
                    const off = !!owner && offFeatures.includes(owner);
                    const checked = all || !!defaults?.permissions.includes(p.key);
                    return (
                      <label key={p.key} className={`flex items-center gap-2 text-sm ${off ? "text-slate-400" : ""}`}>
                        <input type="checkbox" name={off ? undefined : "permissions"} value={p.key} defaultChecked={checked} disabled={readOnly || off} />
                        {/* a grant of a switched-off feature is kept when the role is saved */}
                        {off && checked && !all && <input type="hidden" name="permissions" value={p.key} />}
                        {"hint" in p ? (
                          <span>
                            {p.label}
                            <span className="block text-xs text-slate-500">{p.hint}</span>
                          </span>
                        ) : p.label}
                        {off && <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-500" title={featureDef(owner!).nameBn}>ফিচার বন্ধ</span>}
                        <code className="ml-auto text-xs text-slate-400">{p.key}</code>
                      </label>
                    );
                  })}
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

/** Master checkbox of a permission group: ticks / clears the whole group; half-ticked (indeterminate) when only some are on. */
function GroupSelectAll({ box, keys, label }: { box: RefObject<HTMLDivElement | null>; keys: string[]; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"all" | "some" | "none">("none");
  const boxes = useCallback(
    () => [...(box.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox][name="permissions"]') ?? [])].filter((c) => keys.includes(c.value)),
    [box, keys],
  );
  const sync = useCallback(() => {
    const list = boxes();
    const on = list.filter((c) => c.checked).length;
    setState(on === 0 ? "none" : on === list.length ? "all" : "some");
  }, [boxes]);
  useEffect(() => {
    sync();
    const el = box.current;
    el?.addEventListener("change", sync);
    return () => el?.removeEventListener("change", sync);
  }, [box, sync]);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <label className="flex w-fit items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-ink-900 shadow-sm">
      <input
        ref={ref}
        type="checkbox"
        id="depot-select-all"
        checked={state === "all"}
        onChange={(e) => {
          for (const c of boxes()) c.checked = e.target.checked;
          sync();
        }}
      />
      {label}
    </label>
  );
}
