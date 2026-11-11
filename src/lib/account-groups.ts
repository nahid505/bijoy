// Account group tree — pure helpers shared by the server (reports, validation) and the account form.
//
// A user sub-group sits under a parent group and takes its nature and P&L section (direct / indirect).
// The cash, bank, debtors and creditors groups take no sub-groups: their ledgers have their own pages
// and pickers, keyed on the group's system key.

export const NO_SUBGROUP_KEYS = ["CASH_IN_HAND", "BANK_ACCOUNTS", "SUNDRY_DEBTORS", "SUNDRY_CREDITORS"];
export const RESERVED_GROUPS = ["SUNDRY_DEBTORS", "SUNDRY_CREDITORS"];
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

function buildChildrenMap(groups: GroupNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const g of groups) {
    if (g.parentId && g.parentId !== g.id) {
      map.set(g.parentId, [...(map.get(g.parentId) ?? []), g.id]);
    }
  }
  return map;
}

/** Descendant group ids below `id` (excluding `id` itself; cycle-safe). */
export function descendantGroupIds(groups: GroupNode[], id: string): Set<string> {
  const children = buildChildrenMap(groups);
  const out = new Set<string>();
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const childId of children.get(curr) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      out.add(childId);
      queue.push(childId);
    }
  }
  return out;
}

/** Maximum depth of descendants below `id` (0 = leaf; cycle-safe). */
export function subtreeHeight(groups: GroupNode[], id: string): number {
  const children = buildChildrenMap(groups);
  const seen = new Set<string>([id]);
  const queue: { id: string; h: number }[] = [{ id, h: 0 }];
  let maxH = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr.h > maxH) maxH = curr.h;
    for (const childId of children.get(curr.id) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push({ id: childId, h: curr.h + 1 });
    }
  }
  return maxH;
}

/** Whether group `id` can be moved under `parentId` without cycles, reserved parents, or exceeding MAX_GROUP_DEPTH. */
export function canMoveGroupUnder(
  groups: (GroupNode & { systemKey: string | null })[],
  id: string,
  parentId: string,
): boolean {
  if (!parentId || parentId === id) return false;
  if (!canHaveSubgroups(groups, parentId)) return false;
  if (descendantGroupIds(groups, id).has(parentId)) return false;
  return groupDepth(groups, parentId) + 1 + subtreeHeight(groups, id) <= MAX_GROUP_DEPTH;
}

/** Ancestor group ids above `id` (excluding `id` itself; cycle-safe). */
export function ancestorGroupIds(groups: GroupNode[], id: string): Set<string> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out = new Set<string>();
  const seen = new Set<string>([id]);
  for (let g = byId.get(id); g?.parentId && byId.has(g.parentId) && !seen.has(g.parentId); g = byId.get(g.parentId)) {
    seen.add(g.parentId);
    out.add(g.parentId);
  }
  return out;
}

/** Returns group ids to display on the ledger overview: populated groups, their ancestor parents (so root/parent headers always render and stay editable), matching custom groups, or groups matching the search query. */
export function visibleLedgerGroupIds<T extends GroupNode & { name: string; nature: string; systemKey: string | null }>(
  groups: T[],
  populatedGroupIds: Set<string>,
  opts: { q?: string; nature?: string } = {},
): Set<string> {
  const visible = new Set<string>();
  const q = opts.q?.trim().toLowerCase();
  const addWithAncestors = (id: string) => {
    visible.add(id);
    for (const aid of ancestorGroupIds(groups, id)) visible.add(aid);
  };

  for (const g of groups) {
    if (populatedGroupIds.has(g.id)) {
      addWithAncestors(g.id);
      continue;
    }
    if (opts.nature && g.nature !== opts.nature) continue;
    if (!q && !g.systemKey) {
      addWithAncestors(g.id);
    } else if (q && g.name.toLowerCase().includes(q)) {
      addWithAncestors(g.id);
    }
  }
  return visible;
}
