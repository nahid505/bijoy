"use client";

// Payroll forms (client). Every form posts through a server action; complex ones send one JSON
// "payload" field, validated again on the server.
import Link from "next/link";
import { EntryDateInput } from "@/components/entry-date-input";
import { useMemo, useState } from "react";
import { round2 } from "@/lib/calc";
import { formatMoney } from "@/lib/format";
import {
  ATTENDANCE_LABELS, CALC_TYPE_LABELS, calculatePayslip, COMPONENT_KIND_LABELS, EMPLOYMENT_STATUS_LABELS, summarizeAttendance,
  type AttendanceStatus, type PayCalcType, type PayComponentKind, type PayrollSettingsInput,
} from "@/lib/payroll";
import { SearchableAccountSelect } from "@/components/account-select";
import { ActionButton, ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchSelect, type EmployeeOption } from "@/components/search-select";
import type { AccountOption } from "@/components/trade-parts";

const nextKey = (() => {
  let n = 0;
  return () => ++n;
})();

export interface ComponentOption {
  id: string;
  name: string;
  kind: PayComponentKind;
  calcType: PayCalcType;
  defaultValue: number;
  appliesTo: "REGULAR" | "BONUS";
}

// ───────────────────────── employee ─────────────────────────

export interface EmployeeDefaults {
  code: string;
  name: string;
  mobile: string;
  email: string;
  address: string;
  nid: string;
  tin: string;
  departmentId: string;
  designation: string;
  joiningDate: string;
  exitDate: string;
  status: string;
  basicSalary: number;
  overtimeEligible: boolean;
  overtimeRate: string;
  paymentMethod: string;
  bankName: string;
  bankAccountNo: string;
  notes: string;
  components: { componentId: string; calcType: PayCalcType; value: number }[];
}

export function EmployeeForm({
  action, departments, components, defaults, settings, currency, cancelHref, isEdit,
}: {
  action: FormAction;
  departments: { id: string; name: string }[];
  components: ComponentOption[];
  defaults: EmployeeDefaults;
  settings: PayrollSettingsInput & { workingDays: number };
  currency: string;
  cancelHref: string;
  isEdit: boolean;
}) {
  const [f, setF] = useState(defaults);
  const set = <K extends keyof EmployeeDefaults>(k: K, v: EmployeeDefaults[K]) => setF((x) => ({ ...x, [k]: v }));
  const [lines, setLines] = useState(defaults.components.map((c) => ({ key: nextKey(), ...c, value: String(c.value) })));
  const [revisionNote, setRevisionNote] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const unused = components.filter((c) => !lines.some((l) => l.componentId === c.id));

  // live estimate of a full month without absences (same engine as the payroll)
  const preview = useMemo(() => {
    const ref = (name: string) => ({ componentId: null, name, accountId: "x" });
    try {
      const r = calculatePayslip({
        kind: "REGULAR", year: 2026, month: 1, basic: Number(f.basicSalary) || 0, workingDays: settings.workingDays, fraction: 1,
        attendance: summarizeAttendance([], settings.lateDaysPerAbsence, settings.workingDays), extraOvertimeHours: 0, overtime: { eligible: false, rate: null }, settings,
        structure: lines.filter((l) => l.componentId && byId.get(l.componentId)?.appliesTo === "REGULAR").map((l) => {
          const c = byId.get(l.componentId)!;
          return { componentId: c.id, name: c.name, kind: c.kind, calcType: l.calcType, value: Number(l.value) || 0, accountId: "x", liabilityAccountId: "x" };
        }),
        system: { basic: ref("মূল বেতন"), overtime: ref("ওভারটাইম"), absence: ref("অনুপস্থিতি"), advance: ref("অগ্রিম"), loan: ref("ঋণ") },
        advances: [], manual: [], employee: { joiningDate: new Date(), tin: null },
      });
      return { ok: true as const, ...r };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  }, [f.basicSalary, lines, byId, settings]);

  const payload = JSON.stringify({
    ...f,
    basicSalary: Number(f.basicSalary) || 0,
    exitDate: f.exitDate || null,
    paymentMethod: f.paymentMethod || null,
    components: lines.filter((l) => l.componentId).map((l) => ({ componentId: l.componentId, calcType: l.calcType, value: Number(l.value) || 0 })),
    revisionNote: revisionNote || null,
    effectiveFrom: effectiveFrom || null,
  });
  const percent = (t: PayCalcType) => t === "PERCENT_OF_BASIC" || t === "PERCENT_OF_GROSS";

  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">কর্মচারীর তথ্য</h2></div>
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="কর্মচারী আইডি" name="code" hint={isEdit ? undefined : "ফাঁকা রাখলে স্বয়ংক্রিয় (EMP-0001)"}>
            <input id="code" className="input" value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="EMP-0001" />
          </Field>
          <Field label="নাম *" name="name"><input id="name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required /></Field>
          <Field label="মোবাইল" name="mobile"><input id="mobile" type="tel" className="input" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="01XXXXXXXXX" /></Field>
          <Field label="জাতীয় পরিচয়পত্র (NID)" name="nid"><input id="nid" className="input" value={f.nid} onChange={(e) => set("nid", e.target.value)} inputMode="numeric" data-numeric /></Field>
          <Field label="বিভাগ" name="departmentId">
            <select id="departmentId" className="input" value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="পদবি" name="designation"><input id="designation" className="input" value={f.designation} onChange={(e) => set("designation", e.target.value)} /></Field>
          <Field label="যোগদানের তারিখ *" name="joiningDate"><input id="joiningDate" type="date" className="input" value={f.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} /></Field>
          <Field label="কর্মরত অবস্থা" name="status">
            <select id="status" className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="অব্যাহতির তারিখ" name="exitDate" hint="শেষ মাসের বেতন এই তারিখ পর্যন্ত হিসাব হবে">
            <input id="exitDate" type="date" className="input" value={f.exitDate} onChange={(e) => set("exitDate", e.target.value)} />
          </Field>
          <Field label="ঠিকানা" name="address" className="sm:col-span-2"><input id="address" className="input" value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="ইমেইল" name="email"><input id="email" type="email" className="input" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="টিআইএন (TIN)" name="tin"><input id="tin" className="input" value={f.tin} onChange={(e) => set("tin", e.target.value)} /></Field>
          <Field label="বেতন প্রদানের মাধ্যম" name="paymentMethod">
            <select id="paymentMethod" className="input" value={f.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
              <option value="">—</option><option value="CASH">নগদ</option><option value="BANK">ব্যাংক</option><option value="MOBILE">মোবাইল ব্যাংকিং</option>
            </select>
          </Field>
          {f.paymentMethod && f.paymentMethod !== "CASH" && (
            <>
              <Field label="ব্যাংক / প্রতিষ্ঠান" name="bankName"><input id="bankName" className="input" value={f.bankName} onChange={(e) => set("bankName", e.target.value)} /></Field>
              <Field label="হিসাব / মোবাইল নম্বর" name="bankAccountNo"><input id="bankAccountNo" className="input" value={f.bankAccountNo} onChange={(e) => set("bankAccountNo", e.target.value)} /></Field>
            </>
          )}
          <Field label="নোট" name="notes" className="sm:col-span-2 lg:col-span-3"><input id="notes" className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">বেতন কাঠামো (মাসিক)</h2></div>
        <div className="grid gap-4 p-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-3 lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="মূল বেতন *" name="basicSalary">
                <input id="basicSalary" type="text" inputMode="decimal" data-numeric min="0" step="0.01" className="input-num" value={f.basicSalary || ""} onChange={(e) => set("basicSalary", Number(e.target.value))} />
              </Field>
              <Field label="ওভারটাইম" name="overtimeEligible">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input id="overtimeEligible" type="checkbox" checked={f.overtimeEligible} onChange={(e) => set("overtimeEligible", e.target.checked)} /> প্রযোজ্য
                </label>
              </Field>
              <Field label="ওভারটাইম হার (ঘণ্টায়)" name="overtimeRate" hint={`ফাঁকা = মূল বেতন ÷ (${settings.workingDays} × ${settings.hoursPerDay}) × ${settings.overtimeMultiplier}`}>
                <input id="overtimeRate" type="text" inputMode="decimal" data-numeric min="0" step="0.01" className="input-num" value={f.overtimeRate} onChange={(e) => set("overtimeRate", e.target.value)} disabled={!f.overtimeEligible} />
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th className="min-w-48">ভাতা / কর্তন</th><th className="min-w-40">হিসাব</th><th className="w-36 text-right">টাকা / %</th><th className="w-10" /></tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const c = byId.get(l.componentId);
                    return (
                      <tr key={l.key}>
                        <td>
                          <select className="input" aria-label={`উপাদান ${i + 1}`} value={l.componentId} onChange={(e) => {
                            const nc = byId.get(e.target.value);
                            setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, componentId: e.target.value, calcType: nc?.calcType ?? "FIXED", value: nc ? String(nc.defaultValue || "") : "" } : x)));
                          }}>
                            <option value="">— নির্বাচন —</option>
                            {components.filter((o) => o.id === l.componentId || !lines.some((x) => x.componentId === o.id)).map((o) => (
                              <option key={o.id} value={o.id}>{o.name} · {COMPONENT_KIND_LABELS[o.kind]}{o.appliesTo === "BONUS" ? " (উৎসব)" : ""}</option>
                            ))}
                          </select>
                          <FieldError name={`components.${i}.componentId`} />
                        </td>
                        <td>
                          <select className="input" aria-label={`হিসাবের ধরন ${i + 1}`} value={l.calcType} disabled={c?.calcType === "RULE"} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, calcType: e.target.value as PayCalcType } : x)))}>
                            {(c?.calcType === "RULE" ? ["RULE"] : ["FIXED", "PERCENT_OF_BASIC", ...(c?.kind === "EARNING" ? [] : ["PERCENT_OF_GROSS"])]).map((t) => <option key={t} value={t}>{CALC_TYPE_LABELS[t as PayCalcType]}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="input-num" type="text" inputMode="decimal" data-numeric min="0" step="0.01" aria-label={`পরিমাণ ${i + 1}`} value={l.value} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, value: e.target.value } : x)))} />
                          {percent(l.calcType) && <span className="text-xs text-slate-400">%</span>}
                          <FieldError name={`components.${i}.value`} />
                        </td>
                        <td><button type="button" className="btn-ghost btn-sm text-credit" aria-label="সারি মুছুন" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn-secondary btn-sm" disabled={!unused.length} onClick={() => setLines((ls) => [...ls, { key: nextKey(), componentId: "", calcType: "FIXED", value: "" }])}>+ ভাতা / কর্তন যোগ করুন</button>
            {isEdit && (
              <div className="grid gap-3 border-t border-rule pt-3 sm:grid-cols-2">
                <Field label="কাঠামো পরিবর্তন কার্যকর" name="effectiveFrom" hint="বেতন কাঠামো বদলালে ইতিহাসে সংরক্ষিত হয়">
                  <input id="effectiveFrom" type="date" className="input" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </Field>
                <Field label="পরিবর্তনের কারণ" name="revisionNote"><input id="revisionNote" className="input" value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} placeholder="যেমন: বার্ষিক ইনক্রিমেন্ট" /></Field>
              </div>
            )}
          </div>
          <aside className="rounded-md border border-rule bg-ink-50/60 p-3 text-sm" aria-live="polite">
            <h3 className="mb-2 font-semibold text-ink-900">আনুমানিক মাসিক বেতন</h3>
            {preview.ok ? (
              <dl className="space-y-1">
                {preview.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <dt className={l.kind === "EARNING" ? "text-slate-600" : "text-credit"}>{l.kind === "EARNING" ? "" : "− "}{l.name}</dt>
                    <dd className="tabular-nums">{formatMoney(l.amount, currency)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-rule pt-1 font-semibold"><dt>মোট বেতন</dt><dd className="tabular-nums">{formatMoney(preview.gross, currency)}</dd></div>
                <div className="flex justify-between font-bold text-brand-800"><dt>নিট বেতন</dt><dd className="tabular-nums">{formatMoney(preview.net, currency)}</dd></div>
                {preview.employerCost > 0 && <div className="flex justify-between text-xs text-slate-500"><dt>প্রতিষ্ঠানের অবদান</dt><dd>{formatMoney(preview.employerCost, currency)}</dd></div>}
                <p className="pt-1 text-xs text-slate-400">অনুপস্থিতি, ওভারটাইম ও অগ্রিম ছাড়া পূর্ণ মাসের হিসাব</p>
              </dl>
            ) : (
              <p className="text-xs text-red-600">{preview.message}</p>
            )}
          </aside>
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        <Link prefetch={false} href={cancelHref} className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

// ───────────────────────── attendance ─────────────────────────

export interface AttendanceRowInput {
  employeeId: string;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  status: AttendanceStatus | "";
  overtimeHours: number;
  lateMinutes: number;
  note: string;
}
const STATUSES = Object.keys(ATTENDANCE_LABELS) as AttendanceStatus[];
const TONE_CLASS: Record<string, string> = {
  green: "bg-brand-600 text-white", amber: "bg-amber-500 text-white", red: "bg-red-600 text-white", blue: "bg-sky-600 text-white", slate: "bg-slate-500 text-white",
};

export function AttendanceSheet({ action, date, rows: initial, locked }: { action: FormAction; date: string; rows: AttendanceRowInput[]; locked: string | null }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState("");
  const update = (id: string, patch: Partial<AttendanceRowInput>) => setRows((rs) => rs.map((r) => (r.employeeId === id ? { ...r, ...patch } : r)));
  const changed = rows.filter((r) => {
    const o = initial.find((x) => x.employeeId === r.employeeId)!;
    return o.status !== r.status || o.overtimeHours !== r.overtimeHours || o.lateMinutes !== r.lateMinutes || o.note !== r.note;
  });
  const shown = rows.filter((r) => !filter || `${r.code} ${r.name} ${r.department ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  const counts = STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length] as const).filter(([, n]) => n);
  const payload = JSON.stringify({ date, rows: changed.map((r) => ({ employeeId: r.employeeId, status: r.status || null, overtimeHours: r.overtimeHours || 0, lateMinutes: r.lateMinutes || 0, note: r.note || null })) });

  return (
    <ActionForm action={action} className="space-y-3">
      <input type="hidden" name="payload" value={payload} />
      {locked && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">{locked}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-56" placeholder="কর্মচারী খুঁজুন…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="তালিকায় খুঁজুন" />
        <button type="button" className="btn-secondary btn-sm" disabled={!!locked} onClick={() => setRows((rs) => rs.map((r) => (shown.some((s) => s.employeeId === r.employeeId) && !r.status ? { ...r, status: "PRESENT" } : r)))}>বাকি সবাই উপস্থিত</button>
        <button type="button" className="btn-ghost btn-sm" disabled={!!locked} onClick={() => setRows(initial)}>পরিবর্তন বাতিল</button>
        <span className="text-xs text-slate-500">
          {counts.map(([s, n]) => `${ATTENDANCE_LABELS[s].label} ${n}`).join(" · ") || "কিছু চিহ্নিত নেই"} · চিহ্ন না দেওয়া কর্মদিবস উপস্থিত ধরা হয়
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th className="min-w-44">কর্মচারী</th><th className="min-w-[19rem]">অবস্থা</th><th className="w-24 text-right">ওভারটাইম (ঘণ্টা)</th><th className="w-24 text-right">দেরি (মিনিট)</th><th className="min-w-36">নোট</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.employeeId}>
                <td>
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-slate-400">{[r.code, r.designation, r.department].filter(Boolean).join(" · ")}</span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${r.name} — অবস্থা`}>
                    {STATUSES.map((s) => {
                      const on = r.status === s;
                      return (
                        <button
                          key={s} type="button" role="radio" aria-checked={on} disabled={!!locked} title={ATTENDANCE_LABELS[s].label}
                          className={`rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ring-rule ${on ? TONE_CLASS[ATTENDANCE_LABELS[s].tone] : "bg-white text-slate-600 hover:bg-ink-50"}`}
                          onClick={() => update(r.employeeId, { status: on ? "" : s })}
                        >
                          {ATTENDANCE_LABELS[s].label}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" max="24" step="0.5" aria-label={`${r.name} — ওভারটাইম ঘণ্টা`} value={r.overtimeHours || ""} disabled={!!locked} onChange={(e) => update(r.employeeId, { overtimeHours: Number(e.target.value) || 0, status: r.status || "PRESENT" })} /></td>
                <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" max="1440" step="1" aria-label={`${r.name} — দেরি মিনিট`} value={r.lateMinutes || ""} disabled={!!locked || r.status !== "LATE"} onChange={(e) => update(r.employeeId, { lateMinutes: Number(e.target.value) || 0 })} /></td>
                <td><input className="input" aria-label={`${r.name} — নোট`} value={r.note} disabled={!!locked} onChange={(e) => update(r.employeeId, { note: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!locked && (
        <div className="flex items-center gap-3">
          <SubmitButton>{`হাজিরা সংরক্ষণ করুন${changed.length ? ` (${changed.length})` : ""}`}</SubmitButton>
          {changed.length === 0 && <span className="text-xs text-slate-400">কোনো পরিবর্তন নেই</span>}
        </div>
      )}
    </ActionForm>
  );
}

// ───────────────────────── payslip review ─────────────────────────

export function PayslipAdjustForm({ action, extraOvertimeHours, manual, components, overtimeEligible }: {
  action: FormAction;
  extraOvertimeHours: number;
  manual: { componentId: string; amount: number; note: string }[];
  components: ComponentOption[];
  overtimeEligible: boolean;
}) {
  const [extra, setExtra] = useState(String(extraOvertimeHours || ""));
  const [lines, setLines] = useState(manual.map((m) => ({ key: nextKey(), ...m, amount: String(m.amount) })));
  const payload = JSON.stringify({ extraOvertimeHours: Number(extra) || 0, manual: lines.filter((l) => l.componentId && Number(l.amount) > 0).map((l) => ({ componentId: l.componentId, amount: Number(l.amount), note: l.note || null })) });
  return (
    <ActionForm action={action} className="space-y-3">
      <input type="hidden" name="payload" value={payload} />
      <Field label="অতিরিক্ত ওভারটাইম (ঘণ্টা)" name="extraOvertimeHours" hint={overtimeEligible ? "হাজিরায় এন্ট্রি করা ঘণ্টার সাথে যোগ হবে" : "এই কর্মচারীর ওভারটাইম প্রযোজ্য নয়"}>
        <input id="extraOvertimeHours" className="input-num w-32" type="text" inputMode="decimal" data-numeric min="0" step="0.5" value={extra} disabled={!overtimeEligible} onChange={(e) => setExtra(e.target.value)} />
      </Field>
      <div className="space-y-2">
        <p className="label mb-0">এককালীন ভাতা / কর্তন (এই মাসের জন্য)</p>
        {lines.map((l, i) => (
          <div key={l.key} className="grid grid-cols-12 gap-1.5">
            <select className="input col-span-12 sm:col-span-5" aria-label={`উপাদান ${i + 1}`} value={l.componentId} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, componentId: e.target.value } : x)))}>
              <option value="">— নির্বাচন —</option>
              {components.map((c) => <option key={c.id} value={c.id}>{c.kind === "EARNING" ? "+ " : "− "}{c.name}</option>)}
            </select>
            <input className="input-num col-span-4 sm:col-span-2" type="text" inputMode="decimal" data-numeric min="0" step="0.01" aria-label={`টাকা ${i + 1}`} value={l.amount} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, amount: e.target.value } : x)))} />
            <input className="input col-span-7 sm:col-span-4" placeholder="কারণ" aria-label={`কারণ ${i + 1}`} value={l.note} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, note: e.target.value } : x)))} />
            <button type="button" className="btn-ghost btn-sm col-span-1 text-credit" aria-label="সারি মুছুন" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>
          </div>
        ))}
        <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((ls) => [...ls, { key: nextKey(), componentId: "", amount: "", note: "" }])}>+ ভাতা / কর্তন</button>
      </div>
      <SubmitButton pendingText="হিসাব হচ্ছে…">পুনরায় হিসাব ও সংরক্ষণ</SubmitButton>
    </ActionForm>
  );
}

// ───────────────────────── salary payment ─────────────────────────

export function SalaryPaymentForm({ action, employees, cashAccounts, today, currency, dateLocked }: {
  dateLocked?: boolean;
  action: FormAction;
  employees: { id: string; code: string; name: string; department: string | null; payable: number; months: string }[];
  cashAccounts: AccountOption[];
  today: string;
  currency: string;
}) {
  const [date, setDate] = useState(today);
  const [cashId, setCashId] = useState(cashAccounts[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [rows, setRows] = useState(employees.map((e) => ({ ...e, on: true, amount: String(e.payable) })));
  const chosen = rows.filter((r) => r.on && Number(r.amount) > 0);
  const total = round2(chosen.reduce((s, r) => s + Number(r.amount), 0));
  const payload = JSON.stringify({ date, cashAccountId: cashId, reference: reference || null, narration: null, items: chosen.map((r) => ({ employeeId: r.id, amount: Number(r.amount) })) });
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <section className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="pay-cash">পরিশোধের মাধ্যম (নগদ/ব্যাংক)</label>
          <SearchableAccountSelect id="pay-cash" scope="cash" known={cashAccounts} value={cashId} onChange={(v) => setCashId(v)} currency={currency} />
          <FieldError name="cashAccountId" />
        </div>
        <Field label="তারিখ" name="date"><EntryDateInput id="date" value={date} onChange={setDate} locked={dateLocked} /></Field>
        <Field label="রেফারেন্স" name="reference"><input id="reference" className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="চেক / TrxID" /></Field>
      </section>
      <section className="panel">
        <div className="panel-head flex items-center justify-between gap-2">
          <h2 className="panel-title">প্রদেয় বেতন</h2>
          <div className="flex gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: true })))}>সব</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: false })))}>কেউ না</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="w-10" /><th className="min-w-44">কর্মচারী</th><th className="min-w-36">অপরিশোধিত মাস</th><th className="w-36 text-right">প্রদেয়</th><th className="w-40 text-right">এখন পরিশোধ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`${r.name} নির্বাচন`} checked={r.on} onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, on: e.target.checked } : x)))} /></td>
                  <td><span className="font-medium">{r.name}</span><span className="block text-xs text-slate-400">{[r.code, r.department].filter(Boolean).join(" · ")}</span></td>
                  <td className="text-xs text-slate-600">{r.months}</td>
                  <td className="num">{formatMoney(r.payable, currency)}</td>
                  <td><input className="input-num" type="text" inputMode="decimal" data-numeric min="0" max={r.payable} step="0.01" aria-label={`${r.name} — পরিশোধ`} value={r.amount} disabled={!r.on} onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, amount: e.target.value } : x)))} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td /><td colSpan={3}>মোট ({chosen.length} জন)</td><td className="num">{formatMoney(total, currency)}</td></tr></tfoot>
          </table>
        </div>
        <FieldError name="items" />
      </section>
      <SubmitButton pendingText="পরিশোধ হচ্ছে…">{`বেতন পরিশোধ করুন — ${formatMoney(total, currency)}`}</SubmitButton>
    </ActionForm>
  );
}

// ───────────────────────── advance / loan ─────────────────────────

export function AdvanceForm({ action, cashAccounts, today, currency, employee, dateLocked }: { action: FormAction; cashAccounts: AccountOption[]; today: string; currency: string; employee: EmployeeOption | null; dateLocked?: boolean }) {
  const [emp, setEmp] = useState<EmployeeOption | null>(employee);
  const [kind, setKind] = useState<"ADVANCE" | "LOAN">("ADVANCE");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [installment, setInstallment] = useState("");
  const [cashId, setCashId] = useState(cashAccounts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const months = Number(amount) > 0 && Number(installment) > 0 ? Math.ceil(Number(amount) / Number(installment)) : 0;
  const payload = JSON.stringify({ employeeId: emp?.id ?? "", kind, date, amount: Number(amount) || 0, installment: Number(installment) || 0, cashAccountId: cashId, note: note || null });
  return (
    <ActionForm action={action} className="space-y-3">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="label" htmlFor="adv-employee">কর্মচারী *</label>
          <SearchSelect<EmployeeOption> kind="employees" id="adv-employee" value={emp} onChange={setEmp} placeholder="কর্মচারী খুঁজুন — নাম, আইডি, মোবাইল" />
          <FieldError name="employeeId" />
        </div>
        <Field label="ধরন" name="kind">
          <select id="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as "ADVANCE" | "LOAN")}>
            <option value="ADVANCE">অগ্রিম বেতন</option><option value="LOAN">কর্মচারী ঋণ</option>
          </select>
        </Field>
        <Field label="তারিখ" name="date"><EntryDateInput id="date" value={date} onChange={setDate} locked={dateLocked} /></Field>
        <Field label="টাকা *" name="amount"><input id="amount" type="text" inputMode="decimal" data-numeric min="0" step="0.01" className="input-num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="মাসিক কিস্তি *" name="installment" hint={months ? `প্রায় ${months} মাসে বেতন থেকে কাটা হবে` : "প্রতি মাসের বেতন থেকে কাটা হবে"}>
          <input id="installment" type="text" inputMode="decimal" data-numeric min="0" step="0.01" className="input-num" value={installment} onChange={(e) => setInstallment(e.target.value)} />
        </Field>
        <div>
          <label className="label" htmlFor="adv-cash">প্রদানের মাধ্যম</label>
          <SearchableAccountSelect id="adv-cash" scope="cash" known={cashAccounts} value={cashId} onChange={(v) => setCashId(v)} currency={currency} />
          <FieldError name="cashAccountId" />
        </div>
        <Field label="নোট" name="note" className="sm:col-span-2 lg:col-span-3"><input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <SubmitButton>{kind === "LOAN" ? "ঋণ প্রদান করুন" : "অগ্রিম প্রদান করুন"}</SubmitButton>
    </ActionForm>
  );
}

// ───────────────────────── pay component ─────────────────────────

export interface ComponentDefaults {
  name: string;
  kind: PayComponentKind;
  calcType: PayCalcType;
  defaultValue: number;
  ruleKey: string;
  appliesTo: "REGULAR" | "BONUS";
  accountId: string;
  liabilityAccountId: string;
  taxable: boolean;
  isActive: boolean;
  sortOrder: number;
}

export function ComponentForm({ action, defaults, auto, rules, known, currency, cancelHref }: {
  action: FormAction;
  defaults: ComponentDefaults;
  auto: boolean;
  rules: { key: string; label: string }[];
  known: AccountOption[];
  currency: string;
  cancelHref: string;
}) {
  const [f, setF] = useState(defaults);
  const set = <K extends keyof ComponentDefaults>(k: K, v: ComponentDefaults[K]) => setF((x) => ({ ...x, [k]: v }));
  const calcs: PayCalcType[] = ["FIXED", "PERCENT_OF_BASIC", ...(f.kind === "EARNING" ? [] : (["PERCENT_OF_GROSS"] as PayCalcType[])), ...(rules.length ? (["RULE"] as PayCalcType[]) : [])];
  const payload = JSON.stringify({ ...f, ruleKey: f.ruleKey || null, accountId: f.accountId || null, liabilityAccountId: f.liabilityAccountId || null });
  return (
    <ActionForm action={action}>
      <input type="hidden" name="payload" value={payload} />
      {auto && <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-200">স্বয়ংক্রিয় উপাদান — বেতন হিসাবের সময় নিজে থেকে হিসাব হয়। নাম ও লেজার পরিবর্তন করা যায়।</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="নাম *" name="name"><input id="name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="ধরন" name="kind">
          <select id="kind" className="input" value={f.kind} disabled={auto} onChange={(e) => set("kind", e.target.value as PayComponentKind)}>
            {(Object.keys(COMPONENT_KIND_LABELS) as PayComponentKind[]).map((k) => <option key={k} value={k}>{COMPONENT_KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        {!auto && (
          <>
            <Field label="হিসাবের ধরন (ডিফল্ট)" name="calcType">
              <select id="calcType" className="input" value={f.calcType} onChange={(e) => set("calcType", e.target.value as PayCalcType)}>
                {calcs.map((c) => <option key={c} value={c}>{CALC_TYPE_LABELS[c]}</option>)}
              </select>
            </Field>
            {f.calcType === "RULE" ? (
              <Field label="নিয়ম" name="ruleKey">
                <select id="ruleKey" className="input" value={f.ruleKey} onChange={(e) => set("ruleKey", e.target.value)}>
                  <option value="">— নির্বাচন —</option>
                  {rules.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </Field>
            ) : (
              <Field label={f.calcType === "FIXED" ? "ডিফল্ট টাকা" : "ডিফল্ট শতাংশ (%)"} name="defaultValue" hint="কর্মচারীর কাঠামোতে যোগ করার সময় প্রস্তাবিত মান">
                <input id="defaultValue" type="text" inputMode="decimal" data-numeric min="0" step="0.01" className="input-num" value={f.defaultValue} onChange={(e) => set("defaultValue", Number(e.target.value))} />
              </Field>
            )}
            <Field label="প্রযোজ্য" name="appliesTo">
              <select id="appliesTo" className="input" value={f.appliesTo} onChange={(e) => set("appliesTo", e.target.value as "REGULAR" | "BONUS")}>
                <option value="REGULAR">মাসিক বেতন</option><option value="BONUS">উৎসব ভাতা হিসাব</option>
              </select>
            </Field>
          </>
        )}
        <div>
          <label className="label" htmlFor="c-account">{f.kind === "DEDUCTION" ? "জমা হবে যে লেজারে (ক্রেডিট)" : "খরচের লেজার (ডেবিট)"} *</label>
          <SearchableAccountSelect id="c-account" scope="all" known={known} value={f.accountId} onChange={(v) => set("accountId", v)} currency={currency} noneLabel="— নির্বাচন —" />
          <FieldError name="accountId" />
        </div>
        {f.kind === "EMPLOYER" && (
          <div>
            <label className="label" htmlFor="c-liability">দায়ের লেজার (ক্রেডিট) *</label>
            <SearchableAccountSelect id="c-liability" scope="all" known={known} value={f.liabilityAccountId} onChange={(v) => set("liabilityAccountId", v)} currency={currency} noneLabel="— নির্বাচন —" />
            <FieldError name="liabilityAccountId" />
          </div>
        )}
        <Field label="ক্রম" name="sortOrder"><input id="sortOrder" type="text" inputMode="decimal" data-numeric min="0" className="input-num" value={f.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} /></Field>
        <div className="flex items-end gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} disabled={auto} onChange={(e) => set("isActive", e.target.checked)} /> সক্রিয়</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.taxable} onChange={(e) => set("taxable", e.target.checked)} /> করযোগ্য আয়</label>
        </div>
      </div>
      <div className="flex gap-2">
        <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        <Link prefetch={false} href={cancelHref} className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

// ───────────────────────── settings ─────────────────────────

const WEEKDAYS = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"];

export function PayrollSettingsForm({ action, defaults, known, currency }: {
  action: FormAction;
  defaults: { workingDaysMode: string; fixedWorkingDays: number; weeklyOffDays: number[]; hoursPerDay: number; overtimeMultiplier: number; lateDaysPerAbsence: number; absenceBasis: string; salaryPayableAccountId: string; advanceAccountId: string };
  known: AccountOption[];
  currency: string;
}) {
  const [f, setF] = useState(defaults);
  const set = <K extends keyof typeof defaults>(k: K, v: (typeof defaults)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <ActionForm action={action}>
      <input type="hidden" name="payload" value={JSON.stringify(f)} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="মাসের কর্মদিবস" name="workingDaysMode" hint="দৈনিক বেতন = মাসিক বেতন ÷ কর্মদিবস">
          <select id="workingDaysMode" className="input" value={f.workingDaysMode} onChange={(e) => set("workingDaysMode", e.target.value)}>
            <option value="FIXED">নির্দিষ্ট সংখ্যা</option><option value="CALENDAR">মাসের সব দিন</option><option value="CALENDAR_LESS_OFF_DAYS">মাসের দিন − সাপ্তাহিক ছুটি</option>
          </select>
        </Field>
        {f.workingDaysMode === "FIXED" && (
          <Field label="কর্মদিবস (প্রতি মাসে)" name="fixedWorkingDays"><input id="fixedWorkingDays" type="text" inputMode="decimal" data-numeric min="1" max="31" className="input-num" value={f.fixedWorkingDays} onChange={(e) => set("fixedWorkingDays", Number(e.target.value))} /></Field>
        )}
        <Field label="সাপ্তাহিক ছুটি" name="weeklyOffDays">
          <div className="flex flex-wrap gap-2 text-sm">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1">
                <input type="checkbox" checked={f.weeklyOffDays.includes(i)} onChange={(e) => set("weeklyOffDays", e.target.checked ? [...f.weeklyOffDays, i] : f.weeklyOffDays.filter((x) => x !== i))} /> {d}
              </label>
            ))}
          </div>
        </Field>
        <Field label="দৈনিক কর্মঘণ্টা" name="hoursPerDay"><input id="hoursPerDay" type="text" inputMode="decimal" data-numeric min="1" max="24" step="0.5" className="input-num" value={f.hoursPerDay} onChange={(e) => set("hoursPerDay", Number(e.target.value))} /></Field>
        <Field label="ওভারটাইম গুণক" name="overtimeMultiplier" hint="বাংলাদেশ শ্রম আইন: মূল মজুরির দ্বিগুণ হারে (২)">
          <input id="overtimeMultiplier" type="text" inputMode="decimal" data-numeric min="1" max="5" step="0.25" className="input-num" value={f.overtimeMultiplier} onChange={(e) => set("overtimeMultiplier", Number(e.target.value))} />
        </Field>
        <Field label="কত দিন দেরি = ১ দিনের কর্তন" name="lateDaysPerAbsence" hint="০ = দেরির জন্য কর্তন নেই">
          <input id="lateDaysPerAbsence" type="text" inputMode="decimal" data-numeric min="0" max="31" className="input-num" value={f.lateDaysPerAbsence} onChange={(e) => set("lateDaysPerAbsence", Number(e.target.value))} />
        </Field>
        <Field label="অনুপস্থিতির কর্তন হবে" name="absenceBasis">
          <select id="absenceBasis" className="input" value={f.absenceBasis} onChange={(e) => set("absenceBasis", e.target.value)}>
            <option value="BASIC">মূল বেতন থেকে</option><option value="GROSS">মোট (নির্দিষ্ট) বেতন থেকে</option>
          </select>
        </Field>
        <div>
          <label className="label" htmlFor="s-payable">বেতন প্রদেয় লেজার</label>
          <SearchableAccountSelect id="s-payable" scope="all" known={known} value={f.salaryPayableAccountId} onChange={(v) => set("salaryPayableAccountId", v)} currency={currency} />
        </div>
        <div>
          <label className="label" htmlFor="s-advance">কর্মচারী অগ্রিম/ঋণ লেজার</label>
          <SearchableAccountSelect id="s-advance" scope="all" known={known} value={f.advanceAccountId} onChange={(v) => set("advanceAccountId", v)} currency={currency} />
        </div>
      </div>
      <SubmitButton>সেটিং সংরক্ষণ করুন</SubmitButton>
    </ActionForm>
  );
}

export function DepartmentManager({ departments, addAction }: {
  departments: { id: string; name: string; employees: number; rename: FormAction; remove: FormAction }[];
  addAction: FormAction;
}) {
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-rule">
        {departments.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
            <ActionForm action={d.rename} className="flex flex-1 items-center gap-2">
              <input name="name" defaultValue={d.name} className="input max-w-xs" aria-label={`${d.name} — নাম`} />
              <SubmitButton className="btn-secondary btn-sm">নাম বদলান</SubmitButton>
            </ActionForm>
            <span className="text-xs text-slate-500">{d.employees} জন</span>
            {d.employees === 0 && <ActionButton action={d.remove} label="মুছুন" className="btn-ghost btn-sm text-credit" confirmText={`"${d.name}" বিভাগ মুছবেন?`} />}
          </li>
        ))}
      </ul>
      <ActionForm action={addAction} className="flex flex-wrap items-end gap-2">
        <Field label="নতুন বিভাগ" name="name"><input id="dept-name" name="name" className="input w-60" placeholder="যেমন বিক্রয়, গুদাম, হিসাব" /></Field>
        <SubmitButton className="btn-primary">যোগ করুন</SubmitButton>
      </ActionForm>
    </div>
  );
}
