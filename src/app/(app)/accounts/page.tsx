import type { Metadata } from "next";
import { NATURE_LABELS, type Nature } from "@/lib/accounting";
import { ancestorGroupIds, RESERVED_GROUPS, visibleLedgerGroupIds } from "@/lib/account-groups";
import { FilterBar, FilterField, PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { balancesBefore, listAccounts } from "@/server/services/ledger";
import { accountScopeWhere } from "@/server/party-scope";
import { bookAccountWhere } from "@/server/services/accounting";
import { listAccountGroups } from "@/server/services/master";
import { REPORT_ACCESS } from "@/lib/permissions";
import { AccountsLedgerTable, type LedgerGroupSection } from "./accounts-ledger-table";
import { NewLedgerButton } from "./new-ledger-button";

export const metadata: Metadata = { title: "সকল লেজার (হিসাব খাতের তালিকা)" };

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(REPORT_ACCESS.ledgerView);
  const t = await getT();
  const p = await readParams(searchParams);
  const q = p.q?.trim().toLowerCase();
  const nature = p.nature && p.nature in NATURE_LABELS ? (p.nature as Nature) : undefined;

  const isPrivileged = Boolean(ctx.user.isSuperAdmin || ctx.isOwner);
  const [accountsRaw, allGroups] = await Promise.all([
    listAccounts(ctx.business.id, {
      ...(nature ? { nature } : {}),
      AND: isPrivileged
        ? [bookAccountWhere("GENERAL")]
        : [accountScopeWhere(ctx), bookAccountWhere("GENERAL")],
    }),
    listAccountGroups(ctx.business.id),
  ]);

  const groupById = new Map(allGroups.map((g) => [g.id, g]));
  const ancestorNames = (groupId: string) =>
    [...ancestorGroupIds(allGroups, groupId)]
      .map((aid) => groupById.get(aid)?.name ?? "")
      .filter(Boolean)
      .join(" ");

  const accounts = accountsRaw.filter(
    (a) => !q || `${a.name} ${a.code ?? ""} ${a.groupName} ${ancestorNames(a.groupId)}`.toLowerCase().includes(q),
  );

  const bal = await balancesBefore(ctx.business.id, undefined, accounts.map((a) => a.id));
  const accountsByGroup = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const bucket = accountsByGroup.get(a.groupId) ?? [];
    bucket.push(a);
    accountsByGroup.set(a.groupId, bucket);
  }

  const visibleIds = visibleLedgerGroupIds(allGroups, new Set(accountsByGroup.keys()), { q, nature });
  const sections: LedgerGroupSection[] = allGroups
    .filter((g) => visibleIds.has(g.id))
    .map((g) => ({
      group: g,
      parentName: g.parentId ? (groupById.get(g.parentId)?.name ?? null) : null,
      accounts: (accountsByGroup.get(g.id) ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        code: a.code,
        kind: a.kind,
        nature: a.nature,
        groupId: a.groupId,
        groupName: a.groupName,
        isSystem: a.isSystem,
        isActive: a.isActive,
        imageUrl: a.imageUrl,
        balance: bal.get(a.id) ?? 0,
      })),
    }));

  const cur = ctx.business.currencySymbol;
  const groupOptions = allGroups.filter((g) => !RESERVED_GROUPS.includes(g.systemKey ?? ""));
  const canManage = isPrivileged || can(ctx, "accounts:manage");

  return (
    <>
      <PageHeader
        title={t("সকল লেজার (হিসাব খাতের তালিকা)")}
        description={t("সকল হিসাব খাত, গ্রুপ ও বর্তমান ব্যালেন্স — ব্যালেন্স সরাসরি জার্নাল এন্ট্রি থেকে")}
        crumbs={[{ label: t("হিসাব") }, { label: t("লেজার") }]}
        actions={canManage && <NewLedgerButton groups={groupOptions} allGroups={allGroups} />}
      />

      <section className="panel overflow-hidden border border-slate-200/80 shadow-xs">
        <div className="border-b border-slate-100 p-4">
          <FilterBar action="/accounts">
            <FilterField label={t("ধরন")}>
              <select name="nature" defaultValue={nature ?? ""} className="input w-36">
                <option value="">{t("সব")}</option>
                {Object.entries(NATURE_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label={t("খুঁজুন")}>
              <input
                name="q"
                defaultValue={p.q}
                className="input w-56"
                placeholder={t("নাম, কোড, গ্রুপ…")}
              />
            </FilterField>
          </FilterBar>
        </div>

        <AccountsLedgerTable
          sections={sections}
          allGroups={allGroups}
          currency={cur}
          canManage={canManage}
        />
      </section>
    </>
  );
}
