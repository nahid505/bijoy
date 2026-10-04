import "server-only";
import { SmsSelectionBar } from "@/components/sms-selection";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { formatDate, formatDrCr, formatMoney, toDateInput } from "@/lib/format";
import { ActionButton, PrintButton } from "@/components/forms";
import { PartyForm } from "@/components/party-form";
import { ReportPage } from "@/components/report-page";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, SortHeader, TableWrap } from "@/components/ui";
import { can, requirePermission } from "./auth";
import { pageOf, readParams, totalPages, type SearchParams } from "./params";
import { balancesBefore, statement } from "./services/ledger";
import { reportPeriod } from "./period";
import { amountInBanglaWords } from "@/lib/words";
import { AGING_BUCKETS, partyAging } from "./services/aging";
import { VOUCHER_TYPES } from "@/lib/accounting";
import { partyOpening } from "./services/master";
import { deletePartyAction, savePartyAction, togglePartyAction } from "./actions/masters";

export type PartyKind = "CUSTOMER" | "SUPPLIER";

const CFG = {
  CUSTOMER: {
    title: "কাস্টমার", base: "/customers", view: "customers:view", manage: "customers:manage",
    balanceLabel: "পাওনা (বাকি)", tradeLabel: "মোট বিক্রয়", settledLabel: "মোট আদায়", sign: 1,
    tradeTypes: ["SALES", "SALES_RETURN"] as const, settleType: "RECEIPT",
    openingHint: "হিসাব শুরুর আগে কাস্টমারের কাছে পাওনা টাকা",
    newTrade: { href: "/vouchers/sales/new", label: "+ বিক্রয়", perm: "sales:create" },
    settle: { href: "/vouchers/receipt/new", label: "টাকা আদায় (রিসিপ্ট)" },
  },
  SUPPLIER: {
    title: "সরবরাহকারী", base: "/suppliers", view: "suppliers:view", manage: "suppliers:manage",
    balanceLabel: "দেনা (বাকি)", tradeLabel: "মোট ক্রয়", settledLabel: "মোট পরিশোধ", sign: -1,
    tradeTypes: ["PURCHASE", "PURCHASE_RETURN"] as const, settleType: "PAYMENT",
    openingHint: "হিসাব শুরুর আগে সরবরাহকারীর কাছে দেনা টাকা",
    newTrade: { href: "/vouchers/purchase/new", label: "+ ক্রয়", perm: "purchases:create" },
    settle: { href: "/vouchers/payment/new", label: "টাকা পরিশোধ (পেমেন্ট)" },
  },
} as const;

async function findParty(kind: PartyKind, businessId: string, id: string) {
  return kind === "CUSTOMER"
    ? prisma.customer.findFirst({ where: { id, businessId } })
    : prisma.supplier.findFirst({ where: { id, businessId } });
}

// ───────────────────────── list ─────────────────────────

const groupOf = (r: object) => (r as { groupName?: string | null }).groupName ?? null;

export async function PartyListPage({ kind, searchParams }: { kind: PartyKind; searchParams: SearchParams }) {
  const cfg = CFG[kind];
  const ctx = await requirePermission(cfg.view);
  const p = await readParams(searchParams);
  const { page, skip, take } = pageOf(p);
  const cur = ctx.business.currencySymbol;
  const q = p.q?.trim();
  const where = {
    businessId: ctx.business.id,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { mobile: { contains: q } }, { address: { contains: q, mode: "insensitive" as const } }] } : {}),
    ...(p.status === "inactive" ? { isActive: false } : p.status === "all" ? {} : { isActive: true }),
    ...(kind === "CUSTOMER" && p.group ? { groupName: p.group } : {}),
  };
  const isCustomer = kind === "CUSTOMER";
  const smsSingle = isCustomer && can(ctx, "sms:send");
  const smsBulk = isCustomer && can(ctx, "sms:bulk");
  const groups = isCustomer
    ? (await prisma.customer.groupBy({ by: ["groupName"], where: { businessId: ctx.business.id, groupName: { not: null } }, orderBy: { groupName: "asc" } })).map((g) => g.groupName!)
    : [];
  const [rows, total] = await Promise.all([
    kind === "CUSTOMER"
      ? prisma.customer.findMany({ where, orderBy: p.sort === "recent" ? { createdAt: p.dir === "asc" ? "asc" : "desc" } : { name: p.dir === "desc" ? "desc" : "asc" }, skip, take })
      : prisma.supplier.findMany({ where, orderBy: p.sort === "recent" ? { createdAt: p.dir === "asc" ? "asc" : "desc" } : { name: p.dir === "desc" ? "desc" : "asc" }, skip, take }),
    kind === "CUSTOMER" ? prisma.customer.count({ where }) : prisma.supplier.count({ where }),
  ]);
  const accountIds = rows.map((r) => r.accountId);
  const [bal, trade] = await Promise.all([
    balancesBefore(ctx.business.id, undefined, accountIds),
    prisma.voucher.groupBy({ by: ["partyAccountId", "type"], where: { businessId: ctx.business.id, partyAccountId: { in: accountIds }, type: { in: [...cfg.tradeTypes] } }, _sum: { amount: true } }),
  ]);
  const tradeOf = (accId: string) =>
    round2(trade.filter((t) => t.partyAccountId === accId).reduce((s, t) => s + (t.type === cfg.tradeTypes[0] ? 1 : -1) * num(t._sum.amount), 0));

  return (
    <>
      <PageHeader
        title={cfg.title}
        description={`প্রতিটি ${cfg.title} এর নিজস্ব লেজার — ব্যালেন্স সরাসরি হিসাব থেকে`}
        actions={can(ctx, cfg.manage) && <Link prefetch={false} href={`${cfg.base}/new`} className="btn-primary">+ নতুন {cfg.title}</Link>}
      />
      <section className="panel">
        <FilterBar action={cfg.base}>
          <FilterField label="খুঁজুন"><input name="q" defaultValue={q} placeholder="নাম, মোবাইল, ঠিকানা…" className="input w-60" /></FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={p.status ?? "active"} className="input w-32">
              <option value="active">সক্রিয়</option><option value="inactive">নিষ্ক্রিয়</option><option value="all">সব</option>
            </select>
          </FilterField>
          {isCustomer && groups.length > 0 && (
            <FilterField label="গ্রুপ">
              <select name="group" defaultValue={p.group ?? ""} className="input w-36">
                <option value="">সব গ্রুপ</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </FilterField>
          )}
        </FilterBar>
        {smsBulk && rows.length > 0 && <SmsSelectionBar />}
        {smsBulk && p.group && <p className="no-print border-b border-rule px-3 py-2 text-xs"><Link prefetch={false} href={`/sms/compose?group=${encodeURIComponent(p.group)}`} className="font-semibold text-brand-700 hover:underline">✉ “{p.group}” গ্রুপের সবাইকে এসএমএস</Link></p>}
        {rows.length === 0 ? <EmptyState /> : (
          <TableWrap>
            <table className="table">
              <thead><tr>{smsBulk && <th className="w-8"><span className="sr-only">নির্বাচন</span></th>}<SortHeader basePath={cfg.base} params={p} field="name" label="নাম" /><th>মোবাইল</th>{isCustomer && <th>গ্রুপ</th>}<th>ঠিকানা</th><th className="num">{cfg.tradeLabel}</th><th className="num">বর্তমান ব্যালেন্স</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const b = bal.get(r.accountId) ?? 0;
                  return (
                    <tr key={r.id}>
                      {smsBulk && <td>{r.mobile && <input type="checkbox" name="sms-customer" value={r.id} aria-label={`${r.name} নির্বাচন`} />}</td>}
                      <td><Link prefetch={false} href={`${cfg.base}/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link>{!r.isActive && <> <Badge>নিষ্ক্রিয়</Badge></>}</td>
                      <td>{r.mobile ?? "—"}</td>
                      {isCustomer && <td className="text-xs">{groupOf(r) ? <Link prefetch={false} href={`${cfg.base}?group=${encodeURIComponent(groupOf(r)!)}`} className="hover:underline">{groupOf(r)}</Link> : "—"}</td>}
                      <td className="max-w-xs truncate">{r.address ?? "—"}</td>
                      <td className="num">{formatMoney(tradeOf(r.accountId), cur)}</td>
                      <td className={`num font-semibold ${b > 0 ? "dr" : b < 0 ? "cr" : ""}`}>{formatDrCr(b, cur)}</td>
                      <td className="whitespace-nowrap text-right">
                        {smsSingle && r.mobile && <Link prefetch={false} href={`/sms/compose?customers=${r.id}`} className="btn-ghost btn-sm" title="এসএমএস পাঠান">✉ এসএমএস</Link>}
                        <Link prefetch={false} href={`/accounts/${r.accountId}`} className="btn-secondary btn-sm">লেজার</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath={cfg.base} params={p} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

/// ───────────────────────── profile + baki workspace ─────────────────────────

const TABS = [
  { key: "statement", label: "স্টেটমেন্ট" },
  { key: "invoices", label: "ইনভয়েস ইতিহাস" },
  { key: "payments", label: "পেমেন্ট ইতিহাস" },
  { key: "dues", label: "বকেয়া ও বয়স" },
] as const;

export async function PartyDetailPage({ kind, id, searchParams }: { kind: PartyKind; id: string; searchParams: SearchParams }) {
  const cfg = CFG[kind];
  const ctx = await requirePermission(cfg.view);
  const party = await findParty(kind, ctx.business.id, id);
  if (!party) notFound();
  const cur = ctx.business.currencySymbol;
  const params = await readParams(searchParams);
  const tab = TABS.some((t) => t.key === params.tab) ? params.tab! : "statement";
  const today = new Date(`${toDateInput()}T00:00:00.000Z`);

  const [opening, byType, bal, agingRows] = await Promise.all([
    partyOpening(ctx.business.id, kind, party.accountId),
    prisma.$queryRaw<{ type: string; debit: string; credit: string }[]>`
      SELECT v."type"::text AS type, SUM(je."debit")::text AS debit, SUM(je."credit")::text AS credit
      FROM "JournalEntry" je JOIN "Voucher" v ON v."id" = je."voucherId"
      WHERE je."businessId" = ${ctx.business.id} AND je."accountId" = ${party.accountId}
      GROUP BY v."type"`,
    balancesBefore(ctx.business.id, undefined, [party.accountId]),
    partyAging(ctx.business.id, kind, today, [party.accountId]),
  ]);
  const aging = agingRows[0];
  const t = (type: string) => byType.find((x) => x.type === type);
  const totalDebit = round2(byType.filter((x) => x.type !== "OPENING").reduce((s, x) => s + num(x.debit), 0));
  const totalCredit = round2(byType.filter((x) => x.type !== "OPENING").reduce((s, x) => s + num(x.credit), 0));
  const balance = bal.get(party.accountId) ?? 0;
  const trade =
    kind === "CUSTOMER" ? round2(num(t("SALES")?.debit) - num(t("SALES_RETURN")?.credit)) : round2(num(t("PURCHASE")?.credit) - num(t("PURCHASE_RETURN")?.debit));
  const settled =
    kind === "CUSTOMER"
      ? round2(num(t("SALES")?.credit) + num(t("RECEIPT")?.credit) + num(t("JOURNAL")?.credit))
      : round2(num(t("PURCHASE")?.debit) + num(t("PAYMENT")?.debit) + num(t("JOURNAL")?.debit));
  const due = round2(cfg.sign * balance);
  const creditLimit = "creditLimit" in party ? num(party.creditLimit) : 0;
  const manage = can(ctx, cfg.manage);
  const tabHref = (k: string) => `${cfg.base}/${party.id}?tab=${k}`;
  const shareText = encodeURIComponent(
    `${ctx.business.name}\n${party.name} — ${cfg.balanceLabel}: ${formatMoney(due, cur)}${aging?.overdue ? `\nমেয়াদোত্তীর্ণ: ${formatMoney(aging.overdue, cur)}` : ""}\nতারিখ: ${formatDate(today)}`,
  );
  const mobile = party.mobile?.replace(/\D/g, "");
  const waHref = `https://wa.me/${mobile ? (mobile.startsWith("880") ? mobile : `88${mobile}`) : ""}?text=${shareText}`;

  const profile = (
    <>
      <section className="panel mb-4">
        <div className="grid gap-0 lg:grid-cols-4">
          <dl className="space-y-1 border-b border-rule p-4 text-sm lg:border-b-0 lg:border-r">
            <p className="text-base font-bold text-ink-900">{party.name} {!party.isActive && <Badge>নিষ্ক্রিয়</Badge>}</p>
            {party.mobile && <p>📞 {party.mobile}</p>}
            {party.email && <p>✉ {party.email}</p>}
            {party.address && <p className="text-slate-600">{party.address}</p>}
            <p className="pt-1 text-xs text-slate-500">
              {kind === "CUSTOMER" && <>ক্রেডিট সীমা: <b>{creditLimit ? formatMoney(creditLimit, cur) : "নেই"}</b> · </>}
              পরিশোধের মেয়াদ: <b>{party.creditDays ? `${party.creditDays} দিন` : "তাৎক্ষণিক"}</b>
            </p>
          </dl>
          <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-4 lg:col-span-3">
            <Fig label="প্রারম্ভিক ব্যালেন্স" value={formatMoney(opening, cur)} />
            <Fig label={kind === "CUSTOMER" ? "মোট ইনভয়েস" : "মোট ক্রয় ইনভয়েস"} value={formatMoney(trade, cur)} />
            <Fig label={cfg.settledLabel} value={formatMoney(settled, cur)} tone="text-brand-700" />
            <Fig label={cfg.balanceLabel} value={due >= 0 ? formatMoney(due, cur) : `${formatMoney(-due, cur)} অগ্রিম`} tone={due > 0 ? "cr" : "text-brand-700"} big />
            <Fig label="মোট ডেবিট" value={formatMoney(totalDebit, cur)} tone="dr" />
            <Fig label="মোট ক্রেডিট" value={formatMoney(totalCredit, cur)} tone="cr" />
            <Fig label="মেয়াদোত্তীর্ণ বকেয়া" value={formatMoney(aging?.overdue ?? 0, cur)} tone={(aging?.overdue ?? 0) > 0 ? "cr" : ""} big />
            <Fig
              label={kind === "CUSTOMER" && creditLimit ? "অবশিষ্ট ক্রেডিট" : "বয়স ০-৩০ / ৯০+ দিন"}
              value={kind === "CUSTOMER" && creditLimit ? formatMoney(Math.max(creditLimit - due, 0), cur) : `${formatMoney(aging?.buckets["0-30"] ?? 0, cur)} / ${formatMoney(aging?.buckets["90+"] ?? 0, cur)}`}
            />
          </div>
        </div>
      </section>
      <nav className="no-print mb-3 flex flex-wrap gap-1 border-b border-rule">
        {TABS.map((x) => (
          <Link prefetch={false} key={x.key} href={tabHref(x.key)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === x.key ? "border-brand-600 font-semibold text-brand-800" : "border-transparent text-slate-600 hover:text-ink-900"}`}>
            {x.label}
          </Link>
        ))}
      </nav>
    </>
  );

  const actions = (
    <>
      {party.isActive && can(ctx, cfg.newTrade.perm) && <Link prefetch={false} href={kind === "CUSTOMER" ? "/pos" : `${cfg.newTrade.href}?party=${party.accountId}`} className="btn-primary">{cfg.newTrade.label}</Link>}
      {can(ctx, "vouchers:create") && <Link prefetch={false} href={`${cfg.settle.href}?party=${party.accountId}`} className="btn-secondary">{cfg.settle.label}</Link>}
      <Link prefetch={false} href={`${cfg.base}/${party.id}/statement`} className="btn-secondary">🖨 স্টেটমেন্ট</Link>
      <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-secondary">WhatsApp</a>
      {manage && <Link prefetch={false} href={`${cfg.base}/${party.id}/edit`} className="btn-secondary">সম্পাদনা</Link>}
      {manage && <ActionButton action={togglePartyAction.bind(null, kind, party.id, !party.isActive)} label={party.isActive ? "নিষ্ক্রিয়" : "সক্রিয়"} className="btn-secondary" />}
      {manage && <ActionButton action={deletePartyAction.bind(null, kind, party.id)} label="মুছুন" className="btn-danger" confirmText={`${cfg.title} মুছে ফেলতে চান?`} />}
    </>
  );

  if (tab === "statement") {
    return (
      <ReportPage
        slug="ledger"
        params={{ ...params, accountId: party.accountId }}
        basePath={`${cfg.base}/${party.id}`}
        omitFilters={["account"]}
        title={party.name}
        description={`${cfg.title} প্রোফাইল ও হিসাব বিবরণী (স্টেটমেন্ট)`}
        crumbs={[{ label: cfg.title, href: cfg.base }, { label: party.name }]}
        before={profile}
        extraActions={actions}
      />
    );
  }

  let body: React.ReactNode;
  if (tab === "invoices") {
    const invoices = await prisma.voucher.findMany({
      where: { businessId: ctx.business.id, partyAccountId: party.accountId, type: { in: [...cfg.tradeTypes] } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    const openBy = new Map((aging?.openItems ?? []).map((o) => [o.voucherId, o]));
    body = invoices.length === 0 ? <EmptyState message="কোনো ইনভয়েস নেই" /> : (
      <TableWrap>
        <table className="table">
          <thead><tr><th>তারিখ</th><th>ইনভয়েস</th><th>ধরন</th><th className="num">মোট</th><th className="num">তাৎক্ষণিক পরিশোধ</th><th className="num">এখনো বাকি</th><th>শেষ তারিখ</th><th>অবস্থা</th></tr></thead>
          <tbody>
            {invoices.map((v) => {
              const open = openBy.get(v.id);
              const isReturn = v.type === cfg.tradeTypes[1];
              return (
                <tr key={v.id}>
                  <td className="whitespace-nowrap">{formatDate(v.date)}</td>
                  <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link></td>
                  <td>{VOUCHER_TYPES[v.type].label}</td>
                  <td className="num">{formatMoney(num(v.amount) * (isReturn ? -1 : 1), cur)}</td>
                  <td className="num">{formatMoney(num(v.paidAmount), cur)}</td>
                  <td className="num font-semibold">{open ? formatMoney(open.open, cur) : "—"}</td>
                  <td className="whitespace-nowrap">{open ? formatDate(open.dueDate) : v.dueDate ? formatDate(v.dueDate) : "—"}</td>
                  <td>
                    {isReturn ? <Badge tone="blue">ফেরত</Badge> : open ? (open.overdueDays > 0 ? <Badge tone="red">মেয়াদোত্তীর্ণ {open.overdueDays} দিন</Badge> : <Badge tone="amber">বাকি</Badge>) : <Badge tone="green">পরিশোধিত</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    );
  } else if (tab === "payments") {
    // every entry that REDUCES what is owed: receipts / payments, payment at invoice time, returns, journals
    const rows = await prisma.journalEntry.findMany({
      where: { businessId: ctx.business.id, accountId: party.accountId, ...(kind === "CUSTOMER" ? { credit: { gt: 0 } } : { debit: { gt: 0 } }), voucher: { type: { not: "OPENING" } } },
      orderBy: [{ date: "desc" }],
      take: 300,
      include: { voucher: { select: { id: true, voucherNo: true, type: true, reference: true, payments: { include: { account: { select: { name: true } } } }, cashAccount: { select: { name: true } } } } },
    });
    body = rows.length === 0 ? <EmptyState message="কোনো পেমেন্ট নেই" /> : (
      <TableWrap>
        <table className="table">
          <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>ধরন</th><th>মাধ্যম</th><th>রেফারেন্স</th><th className="num">টাকা</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{formatDate(e.date)}</td>
                <td><Link prefetch={false} href={`/vouchers/v/${e.voucher.id}`} className="text-brand-700 hover:underline">{e.voucher.voucherNo}</Link></td>
                <td>{e.voucher.type === "SALES" || e.voucher.type === "PURCHASE" ? "ইনভয়েসের সময় পরিশোধ" : VOUCHER_TYPES[e.voucher.type].label}</td>
                <td className="text-xs">{e.voucher.payments.length ? e.voucher.payments.map((p) => p.account.name).join(", ") : e.voucher.cashAccount?.name ?? "—"}</td>
                <td className="text-xs">{e.voucher.payments.map((p) => p.reference).filter(Boolean).join(", ") || e.voucher.reference || "—"}</td>
                <td className="num font-semibold text-brand-700">{formatMoney(num(e.debit) + num(e.credit), cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  } else {
    body = !aging || aging.openItems.length === 0 ? <EmptyState message="কোনো বকেয়া নেই ✅" /> : (
      <>
        <div className="grid grid-cols-2 divide-x divide-y divide-rule border-b border-rule sm:grid-cols-4 sm:divide-y-0">
          {AGING_BUCKETS.map((b) => <Fig key={b} label={`${b} দিন`} value={formatMoney(aging.buckets[b], cur)} tone={b === "90+" && aging.buckets[b] > 0 ? "cr" : ""} />)}
        </div>
        <TableWrap>
          <table className="table">
            <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>শেষ তারিখ</th><th className="num">বয়স (দিন)</th><th className="num">মূল টাকা</th><th className="num">বকেয়া</th><th>অবস্থা</th></tr></thead>
            <tbody>
              {aging.openItems.map((o) => (
                <tr key={`${o.voucherId}-${o.date.toISOString()}`}>
                  <td>{formatDate(o.date)}</td>
                  <td><Link prefetch={false} href={`/vouchers/v/${o.voucherId}`} className="text-brand-700 hover:underline">{o.voucherNo}</Link></td>
                  <td>{formatDate(o.dueDate)}</td>
                  <td className="num">{o.daysOld}</td>
                  <td className="num">{formatMoney(o.amount, cur)}</td>
                  <td className="num font-semibold">{formatMoney(o.open, cur)}</td>
                  <td>{o.overdueDays > 0 ? <Badge tone="red">{o.overdueDays} দিন পার</Badge> : <Badge tone="amber">মেয়াদ আছে</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </>
    );
  }

  return (
    <>
      <PageHeader title={party.name} description={`${cfg.title} প্রোফাইল`} crumbs={[{ label: cfg.title, href: cfg.base }, { label: party.name }]} actions={actions} />
      {profile}
      <section className="panel">{body}</section>
    </>
  );
}

function Fig({ label, value, tone = "", big }: { label: string; value: string; tone?: string; big?: boolean }) {
  return (
    <div className={`px-4 py-3 ${big ? "bg-ink-50" : ""}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`${big ? "text-lg" : "text-sm"} font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

// ───────────────────────── create / edit ─────────────────────────

export async function PartyEditPage({ kind, id }: { kind: PartyKind; id: string | null }) {
  const cfg = CFG[kind];
  const ctx = await requirePermission(cfg.manage);
  const party = id ? await findParty(kind, ctx.business.id, id) : null;
  if (id && !party) notFound();
  const opening = party ? await partyOpening(ctx.business.id, kind, party.accountId) : 0;
  return (
    <>
      <PageHeader title={party ? `সম্পাদনা: ${party.name}` : `নতুন ${cfg.title}`} crumbs={[{ label: cfg.title, href: cfg.base }, { label: party?.name ?? "নতুন" }]} />
      <section className="panel max-w-3xl p-5">
        <PartyForm
          action={savePartyAction.bind(null, kind, id)}
          kind={kind}
          defaults={party ? { ...party, openingBalance: opening, creditLimit: "creditLimit" in party ? num(party.creditLimit) : 0 } : {}}
          cancelHref={party ? `${cfg.base}/${party.id}` : cfg.base}
          openingHint={cfg.openingHint}
        />
      </section>
    </>
  );
}


// ───────────────────────── printable / shareable statement ─────────────────────────

export async function PartyStatementPrint({ kind, id, searchParams }: { kind: PartyKind; id: string; searchParams: SearchParams }) {
  const cfg = CFG[kind];
  const ctx = await requirePermission(cfg.view);
  const party = await findParty(kind, ctx.business.id, id);
  if (!party) notFound();
  const params = await readParams(searchParams);
  const { from, to, range } = reportPeriod(params, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const b = ctx.business;
  const [st, agingRows] = await Promise.all([
    statement(b.id, [party.accountId], range),
    partyAging(b.id, kind, new Date(`${to}T00:00:00.000Z`), [party.accountId]),
  ]);
  const aging = agingRows[0];
  const closingDue = round2(cfg.sign * st.closing);

  return (
    <>
      <form method="get" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <label className="block"><span className="label">শুরু</span><input type="date" name="from" defaultValue={from} className="input w-40" /></label>
        <label className="block"><span className="label">শেষ</span><input type="date" name="to" defaultValue={to} className="input w-40" /></label>
        <button type="submit" className="btn-secondary">দেখুন</button>
        <PrintButton label="প্রিন্ট / PDF" />
        <Link prefetch={false} href={`${cfg.base}/${party.id}`} className="btn-ghost">← প্রোফাইল</Link>
      </form>
      <article className="panel print-area mx-auto max-w-[210mm] bg-white p-8 text-sm">
        <header className="flex items-start justify-between gap-6 border-b-2 border-ink-800 pb-3">
          <div className="flex items-start gap-3">
            {b.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo} alt="" className="h-12 w-12 object-contain" />
            )}
            <div>
              <h1 className="text-lg font-bold">{b.name}</h1>
              <p className="text-xs text-slate-600">{[b.address, b.mobile, b.email].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">হিসাব বিবরণী</p>
            <p className="text-xs">{formatDate(from)} — {formatDate(to)}</p>
          </div>
        </header>
        <section className="flex justify-between gap-6 py-3">
          <div>
            <p className="text-xs text-slate-500">{cfg.title}</p>
            <p className="text-base font-semibold">{party.name}</p>
            <p className="text-xs text-slate-600">{[party.mobile, party.address].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">সমাপনী {cfg.balanceLabel}</p>
            <p className="text-xl font-bold tabular-nums">{formatMoney(closingDue, cur)}</p>
            {!!aging?.overdue && <p className="text-xs font-semibold text-credit">মেয়াদোত্তীর্ণ: {formatMoney(aging.overdue, cur)}</p>}
          </div>
        </section>
        <div className="overflow-x-auto print:overflow-visible"><table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-y-2 border-ink-800 bg-ink-50 text-left">
              <th className="px-2 py-1.5">তারিখ</th><th className="px-2 py-1.5">ভাউচার</th><th className="px-2 py-1.5">বিবরণ</th>
              <th className="px-2 py-1.5 text-right">ডেবিট</th><th className="px-2 py-1.5 text-right">ক্রেডিট</th><th className="px-2 py-1.5 text-right">ব্যালেন্স</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-rule font-semibold"><td className="px-2 py-1.5" colSpan={5}>প্রারম্ভিক ব্যালেন্স</td><td className="px-2 py-1.5 text-right tabular-nums">{formatDrCr(st.opening, cur)}</td></tr>
            {st.lines.map((l) => (
              <tr key={l.entryId} className="border-b border-rule">
                <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(l.date)}</td>
                <td className="px-2 py-1.5">{l.voucherNo}</td>
                <td className="px-2 py-1.5">{[VOUCHER_TYPES[l.voucherType].label, l.narration].filter(Boolean).join(" — ")}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.debit ? formatMoney(l.debit, cur) : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.credit ? formatMoney(l.credit, cur) : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatDrCr(l.balance, cur)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-double border-ink-800 font-bold">
              <td className="px-2 py-1.5" colSpan={3}>মোট / সমাপনী</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(st.totalDebit, cur)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(st.totalCredit, cur)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatDrCr(st.closing, cur)}</td>
            </tr>
          </tbody>
        </table></div>
        {aging && aging.openItems.length > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
            {AGING_BUCKETS.map((k) => <div key={k} className="rounded border border-rule p-2"><p className="text-slate-500">{k} দিন</p><p className="font-bold tabular-nums">{formatMoney(aging.buckets[k], cur)}</p></div>)}
          </div>
        )}
        <p className="mt-4 rounded border border-rule bg-ink-50 px-3 py-2"><b>কথায়:</b> {amountInBanglaWords(Math.abs(closingDue))}</p>
        <footer className="mt-14 grid grid-cols-2 gap-10 text-center text-xs text-slate-600">
          <div className="border-t border-slate-500 pt-1">{cfg.title}ের স্বাক্ষর</div>
          <div className="border-t border-slate-500 pt-1">অনুমোদিত স্বাক্ষর</div>
        </footer>
      </article>
    </>
  );
}
