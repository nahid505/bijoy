import type { Metadata } from "next";
import { formatDate, formatDateTime, toBnDigits } from "@/lib/format";
import { Badge, EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { setFeatureAction } from "@/server/actions/features";
import { featureOverview } from "@/server/features";
import { FeatureBoard } from "./feature-board";

export const metadata: Metadata = { title: "ফিচার ব্যবস্থাপনা" };

export default async function FeaturesPage() {
  const ctx = await requirePermission("features:view");
  const manage = can(ctx, "features:manage");
  const canBill = can(ctx, "billing:view");
  const { features, logs } = await featureOverview(ctx.business.id);
  const available = features.filter((f) => f.status === "AVAILABLE");

  return (
    <>
      <PageHeader
        title="ফিচার ব্যবস্থাপনা"
        description="ব্যবসার প্রয়োজন অনুযায়ী মডিউল চালু বা বন্ধ করুন — বন্ধ করলে শুধু প্রবেশ বন্ধ হয়, কোনো তথ্য মুছে যায় না"
        crumbs={[{ label: "ফিচার ব্যবস্থাপনা" }]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="চালু ফিচার" value={toBnDigits(available.filter((f) => f.enabled).length)} tone="green" />
        <StatCard label="বন্ধ ফিচার" value={toBnDigits(available.filter((f) => !f.enabled).length)} tone="red" />
        <StatCard label="প্ল্যানে নেই" value={toBnDigits(available.filter((f) => !f.entitled).length)} />
        <StatCard label="মোট মডিউল" value={toBnDigits(features.length)} tone="blue" />
      </div>
      {!manage && <p className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-200">শুধু দেখার অনুমতি আছে — ফিচার চালু/বন্ধ করতে পারেন অ্যাডমিন বা মালিক।</p>}
      <FeatureBoard
        features={features.map((f) => ({
          key: f.key, icon: f.icon, nameBn: f.nameBn, nameEn: f.nameEn, descriptionBn: f.descriptionBn, descriptionEn: f.descriptionEn,
          tier: f.free ? "FREE" : "PAID", status: f.status, enabled: f.enabled, permissions: f.permissions,
          entitled: f.entitled, plans: f.plans, locked: f.override === false ? "admin" : null, upgrade: canBill && !f.entitled && f.status === "AVAILABLE",
          changed: f.changedAt ? `${f.enabled ? "চালু" : "বন্ধ"}: ${formatDate(f.changedAt)}${f.changedBy ? ` · ${f.changedBy}` : ""}` : null,
          toggle: manage && f.status === "AVAILABLE" && f.entitled ? setFeatureAction.bind(null, f.key, !f.enabled) : undefined,
        }))}
      />
      <section className="panel mt-6">
        <div className="panel-head"><h2 className="panel-title">চালু/বন্ধের ইতিহাস</h2></div>
        {logs.length === 0 ? (
          <EmptyState message="এখনো কোনো ফিচার পরিবর্তন করা হয়নি — সব ফিচার ডিফল্ট অবস্থায় আছে" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>সময়</th><th>ফিচার</th><th>পরিবর্তন</th><th>ব্যবহারকারী</th><th>নোট</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-sm">{formatDateTime(l.at)}</td>
                    <td>{l.name}</td>
                    <td>{l.action === "ENABLED" ? <Badge tone="green">চালু</Badge> : <Badge tone="red">বন্ধ</Badge>}</td>
                    <td className="text-sm">{l.user}</td>
                    <td className="text-sm text-slate-500">{l.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}
