import { describe, expect, it } from "vitest";
import { ancestorGroupIds, canHaveSubgroups, canMoveGroupUnder, descendantGroupIds, effectiveGroupKeys, groupDepth, MAX_GROUP_DEPTH, orderGroupTree, subtreeHeight, visibleLedgerGroupIds } from "@/lib/account-groups";
import { accountGroupSchema } from "@/lib/validation";

const g = (id: string, parentId: string | null = null, systemKey: string | null = null) => ({ id, parentId, systemKey });

describe("account group tree", () => {
  it("orders each parent before its children with depth; siblings keep input order", () => {
    const list = [g("exp", null, "INDIRECT_EXPENSES"), g("fixed", null, "FIXED_ASSETS"), g("office", "exp"), g("transport", "exp"), g("fuel", "transport"), g("machine", "fixed")];
    expect(orderGroupTree(list).map((x) => `${x.id}:${x.depth}`)).toEqual(["exp:0", "office:1", "transport:1", "fuel:2", "fixed:0", "machine:1"]);
  });

  it("an unknown parent or a cycle never drops a group", () => {
    const out = orderGroupTree([g("a", "missing"), g("b", "c"), g("c", "b"), g("d", "d")]);
    expect(out.map((x) => x.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(groupDepth([g("b", "c"), g("c", "b")], "b")).toBe(1);
  });

  it("effective system key comes from the nearest system ancestor", () => {
    const keys = effectiveGroupKeys([g("fixed", null, "FIXED_ASSETS"), g("machine", "fixed"), g("mill", "machine"), g("top")]);
    expect(keys.get("mill")).toBe("FIXED_ASSETS");
    expect(keys.get("machine")).toBe("FIXED_ASSETS");
    expect(keys.get("top")).toBeNull();
  });

  it("no sub-groups under cash, bank, debtors, creditors, or beyond the depth limit", () => {
    const chain = [g("l0", null, "INDIRECT_EXPENSES"), ...Array.from({ length: MAX_GROUP_DEPTH }, (_, i) => g(`l${i + 1}`, `l${i}`))];
    const list = [g("cash", null, "CASH_IN_HAND"), g("bank", null, "BANK_ACCOUNTS"), g("dr", null, "SUNDRY_DEBTORS"), g("cr", null, "SUNDRY_CREDITORS"), ...chain];
    for (const id of ["cash", "bank", "dr", "cr", `l${MAX_GROUP_DEPTH}`, "nope"]) expect(canHaveSubgroups(list, id)).toBe(false);
    for (const id of ["l0", `l${MAX_GROUP_DEPTH - 1}`]) expect(canHaveSubgroups(list, id)).toBe(true);
  });

  it("validation: name required, nature one of the five, parent and description optional", () => {
    expect(accountGroupSchema.parse({ name: " অফিস খরচ ", nature: "EXPENSE", parentId: "", description: "" })).toEqual({ name: "অফিস খরচ", nature: "EXPENSE", parentId: null, description: null });
    const issues = (o: object) => {
      const r = accountGroupSchema.safeParse({ name: "x", nature: "ASSET", parentId: "", description: "", ...o });
      return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    };
    expect(issues({ name: "" })).toContain("name");
    expect(issues({ nature: "" })).toContain("nature");
    expect(issues({ nature: "STOCK" })).toContain("nature");
    expect(issues({ description: "x".repeat(501) })).toContain("description");
    expect(issues({ name: "x".repeat(101) })).toContain("name");
  });

  it("descendants, subtree height and valid move checks prevent cycles and depth overflow", () => {
    const tree = [
      g("root", null, "INDIRECT_EXPENSES"),
      g("a", "root"),
      g("b", "a"),
      g("c", "b"),
      g("other", null),
      g("cash", null, "CASH_IN_HAND"),
    ];
    expect([...descendantGroupIds(tree, "a")].sort()).toEqual(["b", "c"]);
    expect(subtreeHeight(tree, "a")).toBe(2);
    expect(subtreeHeight(tree, "c")).toBe(0);
    // self or descendant cannot be chosen as parent
    expect(canMoveGroupUnder(tree, "a", "a")).toBe(false);
    expect(canMoveGroupUnder(tree, "a", "b")).toBe(false);
    expect(canMoveGroupUnder(tree, "a", "c")).toBe(false);
    // reserved system group cannot be parent
    expect(canMoveGroupUnder(tree, "a", "cash")).toBe(false);
    // valid parent within depth limit
    expect(canMoveGroupUnder(tree, "a", "other")).toBe(true);
    // subtree height of "a" is 2, so moving under a depth-2 parent would put "c" at depth 5 > MAX_GROUP_DEPTH (4)
    const deep = [g("d0"), g("d1", "d0"), g("d2", "d1"), ...tree];
    expect(canMoveGroupUnder(deep, "a", "d2")).toBe(false);
    expect(canMoveGroupUnder(deep, "a", "d1")).toBe(true);
  });

  it("ancestorGroupIds and visibleLedgerGroupIds include all empty groups in default view and full parent-child tree on search", () => {
    const groups = [
      { id: "sysExp", parentId: null, systemKey: "INDIRECT_EXPENSES", name: "পরিচালন ব্যয়", nature: "EXPENSE" },
      { id: "cocola", parentId: null, systemKey: null, name: "কোকোলা ডিপো খরচ", nature: "EXPENSE" },
      { id: "fuel", parentId: "cocola", systemKey: null, name: "গাড়ি খরচ", nature: "EXPENSE" },
      { id: "emptyCustom", parentId: null, systemKey: null, name: "অন্যান্য অফিস খরচ", nature: "EXPENSE" },
      { id: "emptySys", parentId: null, systemKey: "FIXED_ASSETS", name: "স্থায়ী সম্পদ", nature: "ASSET" },
    ];
    expect([...ancestorGroupIds(groups, "fuel")]).toEqual(["cocola"]);

    // Default view (!q): ALL groups (populated, empty custom, empty system) appear
    const visDefault = visibleLedgerGroupIds(groups, new Set(["fuel"]));
    expect(visDefault.has("fuel")).toBe(true);
    expect(visDefault.has("cocola")).toBe(true);
    expect(visDefault.has("emptyCustom")).toBe(true);
    expect(visDefault.has("emptySys")).toBe(true);
    expect(visDefault.has("sysExp")).toBe(true);

    // Nature filter limits empty groups cleanly while preserving populated groups
    const visAsset = visibleLedgerGroupIds(groups, new Set(["fuel"]), { nature: "ASSET" });
    expect(visAsset.has("emptyCustom")).toBe(false);
    expect(visAsset.has("emptySys")).toBe(true);

    // Search matches parent header by name along with its child sub-groups even when sub-group is empty
    const visSearch = visibleLedgerGroupIds(groups, new Set(), { q: "কোকোলা" });
    expect(visSearch.has("cocola")).toBe(true);
    expect(visSearch.has("fuel")).toBe(true);
    expect(visSearch.has("emptyCustom")).toBe(false);
  });
});
