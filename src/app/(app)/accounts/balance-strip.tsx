import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { requirePermission } from "@/server/auth";
import { allowedAccounts } from "@/server/party-scope";
import { balancesByKind, sumBalances } from "@/server/services/ledger";

/** Current balance of every cash / bank ledger — shown above the cash and bank books. */
export async function BalanceStrip({ kind }: { kind: "CASH" | "BANK" }) {
  const ctx = await requirePermission("accounts:view");
  const heads = allowedAccounts(ctx); // account-head restriction: my cash / bank ledgers only
  const rows = (await balancesByKind(ctx.business.id, [kind])).filter((r) => heads === null || heads.includes(r.id));
  const cur = ctx.business.currencySymbol;
  return (
    <section className="panel mb-4">
      <div className="flex flex-wrap divide-x divide-rule">
        {rows.map((r) => (
          <Link prefetch={false} key={r.id} href={`/accounts/${r.id}`} className="min-w-44 flex-1 px-4 py-3 hover:bg-brand-50/50">
            <p className="text-xs text-slate-500">{r.name}</p>
            <p className={`text-base font-bold tabular-nums ${r.balance < 0 ? "text-credit" : "text-ink-900"}`}>{formatMoney(r.balance, cur)}</p>
          </Link>
        ))}
        <div className="min-w-44 flex-1 bg-ink-50 px-4 py-3">
          <p className="text-xs text-slate-500">মোট {kind === "CASH" ? "নগদ" : "ব্যাংক"}</p>
          <p className="text-base font-bold tabular-nums text-brand-700">{formatMoney(sumBalances(rows), cur)}</p>
        </div>
      </div>
    </section>
  );
}
