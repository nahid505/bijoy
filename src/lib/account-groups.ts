// Account group tree — pure helpers shared by the server (reports, validation) and the account form.
//
// A user sub-group sits under a parent group and takes its nature and P&L section (direct / indirect).
// The cash, bank, debtors and creditors groups take no sub-groups: their ledgers have their own pages
// and pickers, keyed on the group's system key.

export const NO_SUBGROUP_KEYS = ["CASH_IN_HAND", "BANK_ACCOUNTS", "SUNDRY_DEBTORS", "SUNDRY_CREDITORS"];
/** Levels allowed below a top group (top group → 1 → … → MAX_GROUP_DEPTH). */
export const MAX_GROUP_DEPTH = 4;

export interface GroupNode {
  id: string;
  parentId: string | null;
}

/** The groups in tree order (each parent followed by its children, siblings in input order) with their depth. */
export function orderGroupTree<T extends GroupNode>(groups: T[]): (T & { depth: number })[] {
  const ids = new Set(groups.map((g) => g.id));
  const children = new Map<string, T[]>();
  for (const g of groups) {
    const key = g.parentId && ids.has(g.parentId) && g.parentId !== g.id ? g.parentId : "";
    children.set(key, [...(children.get(key) ?? []), g]);
  }
  const out: (T & { depth: number })[] = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    for (const g of children.get(key) ?? []) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ ...g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk("", 0);
  // anything left over sits in a cycle (never created by the app) — list it at the top level
  for (const g of groups) if (!seen.has(g.id)) out.push({ ...g, depth: 0 });
  return out;
}

/** Depth of a group: 0 for a top group. */
export function groupDepth(groups: GroupNode[], id: string): number {
  const byId = new Map(groups.map((g) => [g.id, g]));
  let depth = 0;
  const seen = new Set<string>([id]);
  for (let g = byId.get(id); g?.parentId && byId.has(g.parentId) && !seen.has(g.parentId); g = byId.get(g.parentId)) {
    seen.add(g.parentId);
    depth++;
  }
  return depth;
}

/** Each group's effective system key: its own, else the nearest ancestor's (so a sub-group of
 *  স্থায়ী সম্পদ still counts as fixed assets in the cash-flow statement). */
export function effectiveGroupKeys(groups: (GroupNode & { systemKey: string | null })[]): Map<string, string | null> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out = new Map<string, string | null>();
  for (const g of groups) {
    let key: string | null = null;
    const seen = new Set<string>();
    for (let n: typeof g | undefined = g; n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) {
      seen.add(n.id);
      if (n.systemKey) {
        key = n.systemKey;
        break;
      }
    }
    out.set(g.id, key);
  }
  return out;
}

/** Whether a new sub-group may be created under this group. */
export function canHaveSubgroups(groups: (GroupNode & { systemKey: string | null })[], id: string): boolean {
  const g = groups.find((x) => x.id === id);
  return !!g && !NO_SUBGROUP_KEYS.includes(g.systemKey ?? "") && groupDepth(groups, id) < MAX_GROUP_DEPTH;
}
