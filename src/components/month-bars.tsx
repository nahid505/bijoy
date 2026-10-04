import { formatMoney } from "@/lib/format";

// Grouped bars for two series over time. Colours validated with the dataviz palette checker
// (CVD-safe, ≥3:1 contrast). Identity is never colour-alone: legend + tooltip + table view.

export interface BarPoint {
  key: string;
  label: string;
  fullLabel: string;
  a: number;
  b: number;
}

export function GroupedBars({
  title,
  points,
  labelA,
  labelB,
  colorA,
  colorB,
  currency,
  tableLabel = "টেবিল আকারে দেখুন",
}: {
  title: string;
  points: BarPoint[];
  labelA: string;
  labelB: string;
  colorA: string;
  colorB: string;
  currency: string;
  tableLabel?: string;
}) {
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  const totalA = points.reduce((s, p) => s + p.a, 0);
  const totalB = points.reduce((s, p) => s + p.b, 0);
  const dense = points.length > 15;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorA }} />{labelA}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorB }} />{labelB}</span>
        </div>
      </div>
      <div className="px-4 pb-2 pt-4">
        <div className="flex h-40 items-end gap-[3px] border-b border-ink-200" role="img" aria-label={`${title}: ${labelA} ${formatMoney(totalA, currency)}, ${labelB} ${formatMoney(totalB, currency)}`}>
          {points.map((p) => (
            <div key={p.key} className="group relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-t hover:bg-ink-50">
              <div className="w-[40%] rounded-t-[3px]" style={{ height: `${(Math.max(p.a, 0) / max) * 100}%`, background: colorA, minHeight: p.a > 0 ? 2 : 0 }} />
              <div className="w-[40%] rounded-t-[3px]" style={{ height: `${(Math.max(p.b, 0) / max) * 100}%`, background: colorB, minHeight: p.b > 0 ? 2 : 0 }} />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max -translate-x-1/2 rounded-md bg-ink-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg group-hover:block">
                <p className="font-semibold">{p.fullLabel}</p>
                <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: colorA }} />{labelA}: {formatMoney(p.a, currency)}</p>
                <p className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: colorB }} />{labelB}: {formatMoney(p.b, currency)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px] text-[10px] text-slate-500">
          {points.map((p, i) => <span key={p.key} className="flex-1 text-center">{!dense || i % 5 === 0 || i === points.length - 1 ? p.label : ""}</span>)}
        </div>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-brand-700">{tableLabel}</summary>
          <table className="table mt-2">
            <thead><tr><th>সময়</th><th className="num">{labelA}</th><th className="num">{labelB}</th></tr></thead>
            <tbody>
              {points.map((p) => <tr key={p.key}><td>{p.fullLabel}</td><td className="num">{formatMoney(p.a, currency)}</td><td className="num">{formatMoney(p.b, currency)}</td></tr>)}
            </tbody>
            <tfoot><tr><td>মোট</td><td className="num">{formatMoney(totalA, currency)}</td><td className="num">{formatMoney(totalB, currency)}</td></tr></tfoot>
          </table>
        </details>
      </div>
    </section>
  );
}
