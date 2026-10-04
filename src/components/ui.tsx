// Server-safe presentational components.
import Link from "next/link";
import { toBnDigits } from "@/lib/format";
import { getT } from "@/server/i18n";

export async function PageHeader({
  title,
  description,
  actions,
  crumbs,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  crumbs?: { label: string; href?: string }[];
}) {
  const t = await getT();
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {crumbs && (
          <nav className="no-print mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.href ? <Link prefetch={false} href={c.href} className="hover:text-brand-700">{t(c.label)}</Link> : t(c.label)}
                {i < crumbs.length - 1 && <span aria-hidden>›</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-bold text-ink-900">{t(title)}</h1>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function CardHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="panel-head">
      <h2 className="panel-title">{title}</h2>
      {actions}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "slate" | "green" | "red" | "amber" | "blue";
}) {
  const tones = { slate: "text-ink-900", green: "text-brand-700", red: "text-credit", amber: "text-amber-700", blue: "text-debit" };
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

const BADGE_TONES = {
  green: "bg-brand-50 text-brand-800 ring-brand-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${BADGE_TONES[tone]}`}>{children}</span>;
}

export function EmptyState({ message = "কোনো তথ্য পাওয়া যায়নি" }: { message?: string }) {
  return <div className="px-6 py-10 text-center text-sm text-slate-400">{message}</div>;
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

type Params = Record<string, string | undefined>;

export function buildQuery(params: Params, overrides: Params = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function Pagination({ basePath, params, page, totalPages, total }: { basePath: string; params: Params; page: number; totalPages: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="no-print flex items-center justify-between border-t border-rule px-4 py-2.5 text-xs text-slate-500">
      <span>মোট {toBnDigits(total)} টি · পৃষ্ঠা {toBnDigits(page)} / {toBnDigits(totalPages)}</span>
      <div className="flex gap-2">
        {page > 1 && <Link prefetch={false} className="btn-secondary btn-sm" href={`${basePath}${buildQuery(params, { page: String(page - 1) })}`}>← আগের</Link>}
        {page < totalPages && <Link prefetch={false} className="btn-secondary btn-sm" href={`${basePath}${buildQuery(params, { page: String(page + 1) })}`}>পরের →</Link>}
      </div>
    </div>
  );
}

/** GET search/filter bar — works without JavaScript. */
export function FilterBar({ children, action }: { children: React.ReactNode; action: string }) {
  return (
    <form action={action} method="get" className="no-print flex flex-wrap items-end gap-2 border-b border-rule bg-white p-3">
      {children}
      <button type="submit" className="btn-secondary">খুঁজুন</button>
      <Link prefetch={false} href={action} className="btn-ghost">রিসেট</Link>
    </form>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{children}</dd>
    </div>
  );
}

/** Business letterhead shown on printed / PDF documents. */
export function PrintHeader({ business, title, subtitle }: { business: { name: string; address: string | null; mobile: string | null; logo: string | null; binNumber?: string | null }; title: string; subtitle?: string }) {
  return (
    <div className="print-only mb-4 border-b-2 border-ink-800 pb-2">
      <div className="flex items-center gap-3">
        {business.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logo} alt="" className="h-10 w-10 object-contain" />
        )}
        <div>
          <p className="text-base font-bold">{business.name}</p>
          <p className="text-[10px]">{[business.address, business.mobile, business.binNumber ? `BIN: ${business.binNumber}` : null].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <p className="mt-2 text-sm font-semibold">{title}{subtitle ? ` — ${subtitle}` : ""}</p>
    </div>
  );
}

/** Sortable column header link: toggles ?sort=field&dir=asc|desc, keeping other filters. */
export function SortHeader({ basePath, params, field, label, className = "" }: { basePath: string; params: Params; field: string; label: string; className?: string }) {
  const active = params.sort === field;
  const dir = active && params.dir === "asc" ? "desc" : "asc";
  const arrow = active ? (params.dir === "asc" ? "▲" : "▼") : "↕";
  return (
    <th className={className} aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link prefetch={false} href={`${basePath}${buildQuery(params, { sort: field, dir, page: undefined })}`} className="inline-flex items-center gap-1 hover:text-brand-700">
        {label} <span className="text-[10px] opacity-60">{arrow}</span>
      </Link>
    </th>
  );
}
