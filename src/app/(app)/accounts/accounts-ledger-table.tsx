"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NATURE_LABELS, type Nature } from "@/lib/accounting";
import { descendantGroupIds, orderGroupTree } from "@/lib/account-groups";
import { formatMoney } from "@/lib/format";
import { useT } from "@/components/lang";
import { useToast } from "@/components/toaster";
import { LedgerAvatar } from "@/components/ledger-avatar";
import type { GroupOption } from "./account-form";
import { AccountGroupDialog } from "./group-dialog";

export interface LedgerAccountItem {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  nature: string;
  groupId: string;
  groupName: string;
  isSystem: boolean;
  isActive: boolean;
  imageUrl?: string | null;
  balance: number;
}

export interface LedgerGroupSection {
  group: GroupOption;
  parentName: string | null;
  accounts: LedgerAccountItem[];
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: "slate" | "blue" }) {
  const toneClass =
    tone === "blue"
      ? "bg-sky-50 text-sky-800 ring-sky-200"
      : "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${toneClass}`}
    >
      {children}
    </span>
  );
}

export function AccountsLedgerTable({
  sections,
  allGroups,
  currency,
  canManage,
}: {
  sections: LedgerGroupSection[];
  allGroups: GroupOption[];
  currency: string;
  canManage: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [sectionList, setSectionList] = useState(sections);
  const [groupList, setGroupList] = useState(allGroups);
  const [editingGroup, setEditingGroup] = useState<GroupOption | null>(null);

  useEffect(() => {
    setSectionList(sections);
  }, [sections]);

  useEffect(() => {
    setGroupList(allGroups);
  }, [allGroups]);

  const handleGroupUpdated = (updated: GroupOption) => {
    const nextGroups = orderGroupTree(groupList.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)));
    setGroupList(nextGroups);
    const orderedIds = new Map(nextGroups.map((g, idx) => [g.id, { index: idx, depth: g.depth, canParent: g.canParent, name: g.name }]));
    const descendants = descendantGroupIds(nextGroups, updated.id);
    const nameById = new Map(nextGroups.map((g) => [g.id, g.name]));

    setSectionList((prev) =>
      prev
        .map((s) => {
          const meta = orderedIds.get(s.group.id);
          if (s.group.id === updated.id) {
            return {
              ...s,
              group: { ...s.group, ...updated, depth: meta?.depth ?? s.group.depth, canParent: meta?.canParent ?? s.group.canParent },
              parentName: updated.parentId ? (nameById.get(updated.parentId) ?? s.parentName) : null,
              accounts: s.accounts.map((a) => ({
                ...a,
                groupName: updated.name,
                nature: updated.nature,
              })),
            };
          }
          if (descendants.has(s.group.id)) {
            return {
              ...s,
              group: { ...s.group, nature: updated.nature, depth: meta?.depth ?? s.group.depth, canParent: meta?.canParent ?? s.group.canParent },
              parentName: s.group.parentId ? (nameById.get(s.group.parentId) ?? s.parentName) : null,
              accounts: s.accounts.map((a) => ({ ...a, nature: updated.nature })),
            };
          }
          return s;
        })
        .sort((a, b) => (orderedIds.get(a.group.id)?.index ?? 0) - (orderedIds.get(b.group.id)?.index ?? 0)),
    );
    setEditingGroup(null);
    toast(t("অ্যাকাউন্ট গ্রুপ আপডেট হয়েছে"), "success");
    router.refresh();
  };

  const sectionIds = new Set(sectionList.map((s) => s.group.id));
  const hasVisibleChildren = (groupId: string) => {
    for (const did of descendantGroupIds(groupList, groupId)) {
      if (sectionIds.has(did)) return true;
    }
    return false;
  };
  const directTotalByGroup = new Map<string, number>();
  for (const s of sectionList) {
    directTotalByGroup.set(
      s.group.id,
      s.accounts.reduce((sum, a) => sum + a.balance, 0),
    );
  }
  const subtreeTotal = (groupId: string) => {
    let sum = directTotalByGroup.get(groupId) ?? 0;
    for (const did of descendantGroupIds(groupList, groupId)) {
      sum += directTotalByGroup.get(did) ?? 0;
    }
    return sum;
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-slate-50/80 text-xs font-semibold text-gray-600 uppercase tracking-wider">
              <th className="py-3 px-4">{t("হিসাব / বিবরণ")}</th>
              <th className="py-3 px-4 text-right w-36 sm:w-44">
                <span>{t("ডেবিট")}</span> ({currency})
              </th>
              <th className="py-3 px-4 text-right w-36 sm:w-44">
                <span>{t("ক্রেডিট")}</span> ({currency})
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {sectionList.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-12 text-center text-sm text-slate-500">
                  {t("কোনো হিসাব খাত পাওয়া যায়নি")}
                </td>
              </tr>
            ) : (
              sectionList.map(({ group, parentName, accounts }) => {
                const isRoot = group.depth === 0;
                const total = subtreeTotal(group.id);
                const netDr = total > 0 ? total : 0;
                const netCr = total < 0 ? Math.abs(total) : 0;
                const typeLabel = t(NATURE_LABELS[group.nature as Nature] ?? group.nature);

                return (
                  <Fragment key={group.id}>
                    <tr
                      className={
                        isRoot
                          ? "bg-slate-200/75 border-y border-slate-300 font-semibold"
                          : "bg-slate-100/70 border-y border-slate-200 font-medium"
                      }
                    >
                      <td
                        className="py-2.5 px-4"
                        style={group.depth > 0 ? { paddingLeft: `${1 + Math.min(group.depth, 4) * 0.85}rem` } : undefined}
                      >
                        <div className="flex items-center gap-2 flex-wrap group-header">
                          {group.depth > 0 && (
                            <span className="text-xs text-slate-400 select-none" aria-hidden="true">
                              {"—".repeat(group.depth)}└
                            </span>
                          )}
                          {isRoot ? (
                            <h2 className="text-base sm:text-lg font-bold text-gray-800">{group.name}</h2>
                          ) : (
                            <span className="font-bold text-gray-800 text-sm">{group.name}</span>
                          )}
                          <span className="text-xs font-normal text-gray-500">({typeLabel})</span>
                          {accounts.length === 0 && !hasVisibleChildren(group.id) && (
                            <span className="text-[11px] font-normal text-slate-400">
                              ({t("কোনো লেজার নেই")})
                            </span>
                          )}
                          {parentName && (
                            <span className="text-[11px] font-normal text-slate-400">
                              · {parentName}
                            </span>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingGroup(group);
                              }}
                              className="no-print inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors cursor-pointer"
                              title={t(isRoot ? "মূল গ্রুপ সম্পাদনা করুন" : "গ্রুপের নাম পরিবর্তন করুন")}
                              aria-label={t(isRoot ? "মূল গ্রুপ সম্পাদনা করুন" : "গ্রুপের নাম পরিবর্তন করুন")}
                            >
                              <span aria-hidden="true">✏️</span>
                              <span>{t("এডিট")}</span>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-sm text-emerald-700 tabular-nums">
                        {netDr > 0 ? formatMoney(netDr, currency) : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-sm text-rose-700 tabular-nums">
                        {netCr > 0 ? formatMoney(netCr, currency) : "—"}
                      </td>
                    </tr>
                    {accounts.map((a) => {
                      const b = a.balance;
                      const isDr = b > 0;
                      const isCr = b < 0;
                      const absVal = Math.abs(b);

                      const categoryTag =
                        a.kind === "CUSTOMER"
                          ? t("কাস্টমার / গ্রাহক")
                          : a.kind === "SUPPLIER"
                            ? t("সরবরাহকারী")
                            : a.kind === "BANK"
                              ? t("ব্যাংক হিসাব")
                              : a.kind === "CASH"
                                ? t("নগদ তহবিল")
                                : group.name;

                      return (
                        <tr key={a.id} className="hover:bg-slate-50/70 transition-colors">
                          <td
                            className="py-3 px-4"
                            style={group.depth > 0 ? { paddingLeft: `${1.5 + Math.min(group.depth, 4) * 0.85}rem` } : undefined}
                          >
                            <div className="flex items-center gap-3">
                              <LedgerAvatar name={a.name} imageUrl={a.imageUrl} size="md" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Link
                                    prefetch={false}
                                    href={`/accounts/${a.id}`}
                                    className="font-semibold text-gray-900 hover:text-emerald-700 hover:underline transition-colors"
                                  >
                                    {a.name}
                                  </Link>
                                  {!a.isActive && <StatusBadge tone="slate">{t("নিষ্ক্রিয়")}</StatusBadge>}
                                  {a.isSystem && <StatusBadge tone="blue">{t("সিস্টেম")}</StatusBadge>}
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5 truncate">
                                  {a.code ? `${a.code} • ` : ""}
                                  {categoryTag}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right align-middle">
                            {isDr ? (
                              <span className="font-semibold text-sm sm:text-base text-emerald-700 tabular-nums">
                                {formatMoney(b, currency)}
                              </span>
                            ) : (
                              <span className="text-gray-300 font-light">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right align-middle">
                            {isCr ? (
                              <span className="font-semibold text-sm sm:text-base text-rose-700 tabular-nums">
                                {formatMoney(absVal, currency)}
                              </span>
                            ) : (
                              <span className="text-gray-300 font-light">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editingGroup && (
        <AccountGroupDialog
          key={editingGroup.id}
          groups={groupList}
          group={editingGroup}
          onCancel={() => setEditingGroup(null)}
          onSaved={handleGroupUpdated}
        />
      )}
    </>
  );
}
