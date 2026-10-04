import type { Metadata } from "next";
import Link from "next/link";
import { NATURE_LABELS, type Nature } from "@/lib/accounting";
import { formatDrCr } from "@/lib/format";
import { Badge, FilterBar, FilterField, PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { balancesBefore, listAccounts } from "@/server/services/ledger";

export const metadata: Metadata = { title: "লেজার (চার্ট অব অ্যাকাউন্টস)" };

const KIND_LABEL: Record<string, string> = { CASH: "নগদ", BANK: "ব্যাংক", CUSTOMER: "কাস্টমার", SUPPLIER: "সরবরাহকারী" };

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("accounts:view");
  const p = await readParams(searchParams);
  const q = p.q?.trim().toLowerCase();
  const nature = p.nature && p.nature in NATURE_LABELS ? (p.nature as Nature) : undefined;
  const accounts = (await listAccounts(ctx.business.id, nature ? { nature } : {})).filter(
    (a) => !q || `${a.name} ${a.code ?? ""} ${a.groupName}`.toLowerCase().includes(q),
  );
  const bal = await balancesBefore(ctx.business.id, undefined, accounts.map((a) => a.id));
  const groups = new Map<string, typeof accounts>();
  for (const a of accounts) (groups.get(a.groupName) ?? groups.set(a.groupName, []).get(a.groupName)!).push(a);
  const cur = ctx.business.currencySymbol;

  return (
    <>
      <PageHeader
        title="লেজার (চার্ট অব অ্যাকাউন্টস)"
        description="সকল হিসাব খাত, গ্রুপ ও বর্তমান ব্যালেন্স — ব্যালেন্স সরাসরি জার্নাল এন্ট্রি থেকে"
        crumbs={[{ label: "হিসাব" }, { label: "লেজার" }]}
        actions={can(ctx, "accounts:manage") && <Link prefetch={false} href="/accounts/new" className="btn-primary">+ নতুন হিসাব</Link>}
      />
      <section className="panel">
        <FilterBar action="/accounts">
          <FilterField label="ধরন">
            <select name="nature" defaultValue={nature ?? ""} className="input w-36">
              <option value="">সব</option>
              {Object.entries(NATURE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FilterField>
          <FilterField label="খুঁজুন"><input name="q" defaultValue={p.q} className="input w-56" placeholder="নাম, কোড, গ্রুপ…" /></FilterField>
        </FilterBar>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="w-20">কোড</th><th>হিসাবের নাম</th><th>ধরন</th><th className="num">বর্তমান ব্যালেন্স</th></tr></thead>
            <tbody>
              {[...groups].map(([group, list]) => (
                <GroupRows key={group} group={group} nature={list[0].nature as Nature} list={list} bal={bal} cur={cur} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function GroupRows({ group, nature, list, bal, cur }: { group: string; nature: Nature; list: Awaited<ReturnType<typeof listAccounts>>; bal: Map<string, number>; cur: string }) {
  const total = list.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
  return (
    <>
      <tr className="row-group">
        <td />
        <td>{group} <span className="text-xs font-normal text-slate-500">({NATURE_LABELS[nature]})</span></td>
        <td />
        <td className={`num ${total > 0 ? "dr" : total < 0 ? "cr" : ""}`}>{formatDrCr(total, cur)}</td>
      </tr>
      {list.map((a) => {
        const b = bal.get(a.id) ?? 0;
        return (
          <tr key={a.id}>
            <td className="text-xs text-slate-500">{a.code}</td>
            <td style={{ paddingLeft: "1.6rem" }}>
              <Link prefetch={false} href={`/accounts/${a.id}`} className="font-medium hover:text-brand-700 hover:underline">{a.name}</Link>
              {!a.isActive && <span className="ml-2"><Badge>নিষ্ক্রিয়</Badge></span>}
              {a.isSystem && <span className="ml-2"><Badge tone="blue">সিস্টেম</Badge></span>}
            </td>
            <td>{KIND_LABEL[a.kind] ? <Badge tone={a.kind === "CASH" ? "green" : a.kind === "BANK" ? "blue" : "slate"}>{KIND_LABEL[a.kind]}</Badge> : null}</td>
            <td className={`num ${b > 0 ? "dr" : b < 0 ? "cr" : ""}`}>{formatDrCr(b, cur)}</td>
          </tr>
        );
      })}
    </>
  );
}
