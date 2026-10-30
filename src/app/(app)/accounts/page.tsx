import type { Metadata } from "next";
import Link from "next/link";
import { NATURE_LABELS, type Nature } from "@/lib/accounting";
import { formatMoney } from "@/lib/format";
import { Badge, FilterBar, FilterField, PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { balancesBefore, listAccounts } from "@/server/services/ledger";
import { accountScopeWhere } from "@/server/party-scope";
import { bookAccountWhere } from "@/server/services/accounting";
import { accountGroupOptions } from "@/server/services/master";
import { REPORT_ACCESS } from "@/lib/permissions";
import { LedgerAvatar } from "@/components/ledger-avatar";
import { NewLedgerButton } from "./new-ledger-button";

export const metadata: Metadata = { title: "সকল লেজার (হিসাব খাতের তালিকা)" };

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(REPORT_ACCESS.ledgerView);
  const t = await getT();
  const p = await readParams(searchParams);
  const q = p.q?.trim().toLowerCase();
  const nature = p.nature && p.nature in NATURE_LABELS ? (p.nature as Nature) : undefined;

  const accounts = (
    await listAccounts(ctx.business.id, {
      ...(nature ? { nature } : {}),
      AND: [accountScopeWhere(ctx), bookAccountWhere("GENERAL")],
    })
  ).filter(
    (a) => !q || `${a.name} ${a.code ?? ""} ${a.groupName}`.toLowerCase().includes(q)
  );

  const bal = await balancesBefore(ctx.business.id, undefined, accounts.map((a) => a.id));
  const groups = new Map<string, typeof accounts>();
  for (const a of accounts) {
    (groups.get(a.groupName) ?? groups.set(a.groupName, []).get(a.groupName)!).push(a);
  }
  const cur = ctx.business.currencySymbol;
  const groupOptions = await accountGroupOptions(ctx.business.id);

  return (
    <>
      <PageHeader
        title={t("সকল লেজার (হিসাব খাতের তালিকা)")}
        description={t("সকল হিসাব খাত, গ্রুপ ও বর্তমান ব্যালেন্স — ব্যালেন্স সরাসরি জার্নাল এন্ট্রি থেকে")}
        crumbs={[{ label: t("হিসাব") }, { label: t("লেজার") }]}
        actions={
          can(ctx, "accounts:manage") && (
            <NewLedgerButton groups={groupOptions} />
          )
        }
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

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-slate-50/80 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                <th className="py-3 px-4">{t("হিসাব / বিবরণ")}</th>
                <th className="py-3 px-4 text-right w-36 sm:w-44">
                  <span>{t("ডেবিট")}</span> ({cur})
                </th>
                <th className="py-3 px-4 text-right w-36 sm:w-44">
                  <span>{t("ক্রেডিট")}</span> ({cur})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {groups.size === 0 ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-sm text-slate-500">
                    {t("কোনো হিসাব খাত পাওয়া যায়নি")}
                  </td>
                </tr>
              ) : (
                [...groups].map(([group, list]) => (
                  <GroupRows
                    key={group}
                    group={group}
                    nature={list[0].nature as Nature}
                    list={list}
                    bal={bal}
                    cur={cur}
                    t={t}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function GroupRows({
  group,
  nature,
  list,
  bal,
  cur,
  t,
}: {
  group: string;
  nature: Nature;
  list: Awaited<ReturnType<typeof listAccounts>>;
  bal: Map<string, number>;
  cur: string;
  t: (s: string) => string;
}) {
  const total = list.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
  const netDr = total > 0 ? total : 0;
  const netCr = total < 0 ? Math.abs(total) : 0;

  return (
    <>
      <tr className="bg-slate-100/70 border-y border-slate-200 font-medium">
        <td className="py-2.5 px-4">
          <span className="font-bold text-slate-800 text-sm">{group}</span>
          <span className="ml-2 text-xs font-normal text-slate-500">
            ({t(NATURE_LABELS[nature])})
          </span>
        </td>
        <td className="py-2.5 px-4 text-right font-bold text-sm text-emerald-700 tabular-nums">
          {netDr > 0 ? formatMoney(netDr, cur) : "—"}
        </td>
        <td className="py-2.5 px-4 text-right font-bold text-sm text-rose-700 tabular-nums">
          {netCr > 0 ? formatMoney(netCr, cur) : "—"}
        </td>
      </tr>
      {list.map((a) => {
        const b = bal.get(a.id) ?? 0;
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
                  : a.groupName;

        return (
          <tr
            key={a.id}
            className="hover:bg-slate-50/70 transition-colors"
          >
            <td className="py-3 px-4">
              <div className="flex items-center gap-3">
                <LedgerAvatar
                  name={a.name}
                  imageUrl={a.imageUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      prefetch={false}
                      href={`/accounts/${a.id}`}
                      className="font-semibold text-gray-900 hover:text-emerald-700 hover:underline transition-colors"
                    >
                      {a.name}
                    </Link>
                    {!a.isActive && <Badge tone="slate">{t("নিষ্ক্রিয়")}</Badge>}
                    {a.isSystem && <Badge tone="blue">{t("সিস্টেম")}</Badge>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {a.code ? `${a.code} • ` : ""}{categoryTag}
                  </div>
                </div>
              </div>
            </td>
            <td className="py-3 px-4 text-right align-middle">
              {isDr ? (
                <span className="font-semibold text-sm sm:text-base text-emerald-700 tabular-nums">
                  {formatMoney(b, cur)}
                </span>
              ) : (
                <span className="text-gray-300 font-light">—</span>
              )}
            </td>
            <td className="py-3 px-4 text-right align-middle">
              {isCr ? (
                <span className="font-semibold text-sm sm:text-base text-rose-700 tabular-nums">
                  {formatMoney(absVal, cur)}
                </span>
              ) : (
                <span className="text-gray-300 font-light">—</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
