"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FEATURE_ACTION_LABELS, type FeatureAction } from "@/lib/features";
import { ActionButton, type FormAction } from "@/components/forms";
import { useT } from "@/components/lang";

export interface FeatureCard {
  key: string;
  icon: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string;
  descriptionEn: string;
  tier: "FREE" | "PAID";
  status: "AVAILABLE" | "COMING_SOON";
  enabled: boolean;
  /** included in the company's current subscription plan */
  entitled: boolean;
  /** plans (Bangla names) that include it */
  plans: string[];
  /** "admin" = switched off for this company by the platform administrator */
  locked: "admin" | null;
  /** show an upgrade link (not in plan, viewer can see billing) */
  upgrade: boolean;
  changed: string | null; // "৫ অক্টোবর ২০২৬ · রহিম"
  permissions: { action: string; permission: string; owned: boolean }[];
  /** bound server action; absent = read-only viewer */
  toggle?: FormAction;
}

const FILTERS = [
  { key: "all", label: "সব" },
  { key: "on", label: "চালু" },
  { key: "off", label: "বন্ধ" },
  { key: "free", label: "ফ্রি" },
  { key: "paid", label: "পেইড" },
  { key: "soon", label: "শীঘ্রই আসছে" },
  { key: "locked", label: "প্ল্যানে নেই" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const match = (f: FeatureCard, filter: Filter) =>
  filter === "all" ||
  (filter === "on" && f.enabled) ||
  (filter === "off" && !f.enabled && f.status === "AVAILABLE") ||
  (filter === "free" && f.tier === "FREE") ||
  (filter === "paid" && f.tier === "PAID") ||
  (filter === "soon" && f.status === "COMING_SOON") ||
  (filter === "locked" && !f.entitled && f.status === "AVAILABLE");

export function FeatureBoard({ features }: { features: FeatureCard[] }) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return features.filter((f) => match(f, filter) && (!s || `${f.nameBn} ${f.nameEn} ${f.descriptionBn} ${f.descriptionEn}`.toLowerCase().includes(s)));
  }, [features, filter, q]);
  const count = (k: Filter) => features.filter((f) => match(f, k)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("🔍 ফিচার খুঁজুন…")} aria-label={t("ফিচার খুঁজুন")} className="input w-full sm:w-64" />
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("ফিচার ফিল্টার")}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${filter === f.key ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-rule hover:bg-ink-50"}`}
            >
              {t(f.label)} <span className="opacity-70">{count(f.key)}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="panel p-8 text-center text-sm text-slate-500">{t("এই ফিল্টারে কোনো ফিচার নেই")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((f) => {
            const soon = f.status === "COMING_SOON";
            const grouped = Object.entries(
              f.permissions.reduce<Record<string, string[]>>((m, p) => ((m[p.action] ??= []).push(p.permission), m), {}),
            );
            return (
              <li key={f.key} id={`feature-${f.key}`} className={`panel flex flex-col p-4 ${f.enabled ? "ring-1 ring-brand-200" : ""}`} aria-label={`${f.nameBn} (${f.nameEn})`}>
                <div className="flex items-start gap-3">
                  <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-2xl ${f.enabled ? "bg-brand-50" : "bg-ink-50 grayscale"}`}>{f.icon}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold leading-snug text-ink-900">{f.nameBn}</h2>
                    <p className="text-xs text-slate-500">{f.nameEn}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${f.tier === "FREE" ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>{f.tier === "FREE" ? t("ফ্রি") : t("পেইড")}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${soon ? "bg-slate-100 text-slate-600 ring-slate-200" : f.enabled ? "bg-brand-50 text-brand-800 ring-brand-200" : "bg-red-50 text-red-800 ring-red-200"}`}>
                      {soon ? t("শীঘ্রই আসছে") : f.enabled ? t("চালু") : !f.entitled ? t("প্ল্যানে নেই") : t("বন্ধ")}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-700">{f.descriptionBn}</p>
                <p className="mt-1 text-xs text-slate-500">{f.descriptionEn}</p>
                {!soon && !f.entitled && (
                  <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-amber-200">
                    {f.locked === "admin" ? t("প্ল্যাটফর্ম অ্যাডমিন এই ফিচারটি বন্ধ রেখেছেন") : f.plans.length ? `${t("যে প্ল্যানে আছে")}: ${f.plans.join(", ")}` : t("কোনো প্ল্যানে নেই")}
                  </p>
                )}
                {grouped.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-slate-500 hover:text-ink-800">{t("অনুমতি")} ({grouped.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {grouped.map(([action, perms]) => (
                        <li key={action}><span className="font-medium text-slate-600">{t(FEATURE_ACTION_LABELS[action as FeatureAction] ?? action)}:</span> <code className="text-slate-500">{perms.join(", ")}</code></li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-4">
                  <span className="text-[11px] text-slate-400">{f.changed ?? ""}</span>
                  {soon ? (
                    <button type="button" className="btn-secondary btn-sm" disabled>{t("শীঘ্রই আসছে")}</button>
                  ) : !f.entitled ? (
                    f.upgrade && f.locked !== "admin" ? <Link prefetch={false} href="/billing" className="btn-primary btn-sm">{t("আপগ্রেড করুন")}</Link> : null
                  ) : f.toggle ? (
                    f.enabled ? (
                      <ActionButton
                        action={f.toggle}
                        label={t("বন্ধ করুন")}
                        className="btn-secondary btn-sm"
                        confirmText={`"${f.nameBn}" বন্ধ করলে এর মেনু ও পাতা বন্ধ হবে। সংরক্ষিত তথ্য মুছে যাবে না — আবার চালু করলে সব ফিরে আসবে। নিশ্চিত?`}
                      />
                    ) : (
                      <ActionButton action={f.toggle} label={t("চালু করুন")} className="btn-primary btn-sm" />
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
