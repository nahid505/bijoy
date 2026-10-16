import { describe, expect, it } from "vitest";
import { canHaveSubgroups, effectiveGroupKeys, groupDepth, MAX_GROUP_DEPTH, orderGroupTree } from "@/lib/account-groups";
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
});
