"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NATURE_LABELS, type Nature } from "@/lib/accounting";
import { ancestorGroupIds, descendantGroupIds, orderGroupTree } from "@/lib/account-groups";
import { useT } from "@/components/lang";
import { useToast } from "@/components/toaster";
import type { GroupOption } from "@/app/(app)/accounts/account-form";
import { AccountGroupDialog } from "@/app/(app)/accounts/group-dialog";

const NATURES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export function AccountGroupsClient({
  initialGroups,
  accountCounts,
  canManage,
}: {
  initialGroups: GroupOption[];
  accountCounts: Record<string, number>;
  canManage: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [natureFilter, setNatureFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [editingGroup, setEditingGroup] = useState<GroupOption | null>(null);
  const [creatingWithParent, setCreatingWithParent] = useState<string | null>(null);

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchIds = new Set<string>();
    for (const g of groups) {
      if (natureFilter && g.nature !== natureFilter) continue;
      if (!q || g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q)) {
        matchIds.add(g.id);
        for (const aid of ancestorGroupIds(groups, g.id)) matchIds.add(aid);
      }
    }
    return groups.filter((g) => matchIds.has(g.id));
  }, [groups, natureFilter, query]);

  // Group tree sections anchored by root parent groups (depth === 0)
  const parentCards = useMemo(() => {
    const roots = visibleGroups.filter((g) => g.depth === 0);
    const rootSet = new Set(roots.map((r) => r.id));
    const buckets = new Map<string, GroupOption[]>();
    for (const r of roots) buckets.set(r.id, []);

    for (const g of visibleGroups) {
      if (g.depth === 0) continue;
      const ancestors = ancestorGroupIds(groups, g.id);
      const topParent = roots.find((r) => ancestors.has(r.id));
      if (topParent && rootSet.has(topParent.id)) {
        buckets.get(topParent.id)!.push(g);
      }
    }

    return roots.map((root) => ({
      parent: root,
      children: buckets.get(root.id) ?? [],
    }));
  }, [visibleGroups, groups]);

  const subtreeAccountCount = (groupId: string) => {
    let total = accountCounts[groupId] ?? 0;
    for (const did of descendantGroupIds(groups, groupId)) {
      total += accountCounts[did] ?? 0;
    }
    return total;
  };

  const handleSaved = (saved: GroupOption, mode: "edit" | "create") => {
    setGroups((prev) => {
      const exists = prev.some((g) => g.id === saved.id);
      const updatedList = exists
        ? prev.map((g) => (g.id === saved.id ? { ...g, ...saved } : g))
        : [...prev, saved];
      const nextOrdered = orderGroupTree(updatedList);
      if (mode === "edit") {
        const descendants = descendantGroupIds(nextOrdered, saved.id);
        return nextOrdered.map((g) =>
          descendants.has(g.id) ? { ...g, nature: saved.nature } : g,
        );
      }
      return nextOrdered;
    });
    setEditingGroup(null);
    setCreatingWithParent(null);
    toast(
      t(mode === "edit" ? "অ্যাকাউন্ট গ্রুপ আপডেট হয়েছে" : "নতুন অ্যাকাউন্ট গ্রুপ তৈরি হয়েছে"),
      "success",
    );
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="label" htmlFor="agFilterNature">
              {t("মূল ধরন")}
            </label>
            <select
              id="agFilterNature"
              value={natureFilter}
              onChange={(e) => setNatureFilter(e.target.value)}
              className="input w-40"
            >
              <option value="">{t("সব")}</option>
              {NATURES.map((n) => (
                <option key={n} value={n}>
                  {t(NATURE_LABELS[n])}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="agSearch">
              {t("খুঁজুন")}
            </label>
            <input
              id="agSearch"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("গ্রুপের নাম লিখুন…")}
              className="input w-56"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link prefetch={false} href="/accounts" className="btn-secondary">
            {t("সকল লেজার দেখুন")}
          </Link>
          {canManage && (
            <button
              type="button"
              onClick={() => setCreatingWithParent("")}
              className="btn-primary"
            >
              + {t("নতুন অ্যাকাউন্ট গ্রুপ")}
            </button>
          )}
        </div>
      </div>

      {parentCards.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-slate-500">
          {t("কোনো অ্যাকাউন্ট গ্রুপ পাওয়া যায়নি")}
        </div>
      ) : (
        <div className="space-y-3">
          {parentCards.map(({ parent, children }) => {
            const typeLabel = t(NATURE_LABELS[parent.nature as Nature] ?? parent.nature);
            const directCount = accountCounts[parent.id] ?? 0;
            const totalCount = subtreeAccountCount(parent.id);

            return (
              <section key={parent.id} className="panel overflow-hidden border border-slate-200/90">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-100/80 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-bold text-gray-800">{parent.name}</h2>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setEditingGroup(parent)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors cursor-pointer"
                          title={t("মূল গ্রুপ সম্পাদনা করুন")}
                        >
                          <span aria-hidden="true">✏️</span>
                          <span>{t("এডিট")}</span>
                        </button>
                      )}
                      <span className="rounded bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {typeLabel}
                      </span>
                      {parent.systemKey && (
                        <span className="rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">
                          {t("সিস্টেম")}
                        </span>
                      )}
                    </div>
                    {parent.description && (
                      <p className="text-xs text-slate-500">{parent.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 tabular-nums">
                      {t("হিসাব")}: {directCount}
                      {children.length > 0 ? ` (${t("মোট")}: ${totalCount})` : ""}
                    </span>
                    {canManage && parent.canParent && (
                      <button
                        type="button"
                        onClick={() => setCreatingWithParent(parent.id)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        + {t("সাব-গ্রুপ")}
                      </button>
                    )}
                  </div>
                </div>

                {children.length > 0 && (
                  <ul className="divide-y divide-slate-100 bg-white">
                    {children.map((sub) => {
                      const subTypeLabel = t(NATURE_LABELS[sub.nature as Nature] ?? sub.nature);
                      const subCount = accountCounts[sub.id] ?? 0;

                      return (
                        <li
                          key={sub.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2.5 pr-4 hover:bg-slate-50/70 transition-colors"
                          style={{ paddingLeft: `${1 + sub.depth * 1.25}rem` }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-slate-400 select-none" aria-hidden="true">
                                └
                              </span>
                              <span className="font-semibold text-sm text-gray-800">{sub.name}</span>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => setEditingGroup(sub)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors cursor-pointer"
                                  title={t("গ্রুপের নাম পরিবর্তন করুন")}
                                >
                                  <span aria-hidden="true">✏️</span>
                                  <span>{t("এডিট")}</span>
                                </button>
                              )}
                              <span className="text-xs text-slate-500">({subTypeLabel})</span>
                            </div>
                            {sub.description && (
                              <p className="mt-0.5 pl-4 text-xs text-slate-500">{sub.description}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 tabular-nums">
                              {t("হিসাব")}: {subCount}
                            </span>
                            {canManage && sub.canParent && (
                              <button
                                type="button"
                                onClick={() => setCreatingWithParent(sub.id)}
                                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                              >
                                + {t("সাব-গ্রুপ")}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editingGroup && (
        <AccountGroupDialog
          key={editingGroup.id}
          groups={groups}
          group={editingGroup}
          onCancel={() => setEditingGroup(null)}
          onSaved={(saved) => handleSaved(saved, "edit")}
        />
      )}

      {creatingWithParent !== null && (
        <AccountGroupDialog
          key={`new-${creatingWithParent}`}
          groups={groups}
          defaultParentId={creatingWithParent || undefined}
          onCancel={() => setCreatingWithParent(null)}
          onSaved={(saved) => handleSaved(saved, "create")}
        />
      )}
    </div>
  );
}
