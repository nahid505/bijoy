export const PAGE_SIZE = 25;

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Normalises Next.js searchParams to single string values. */
export async function readParams(sp: SearchParams): Promise<Record<string, string | undefined>> {
  const raw = await sp;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

export function pageOf(params: Record<string, string | undefined>) {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  return { page, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
}

export function totalPages(total: number) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
