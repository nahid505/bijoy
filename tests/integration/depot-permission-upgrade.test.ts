// The depot_permissions_v2 migration: roles made with the first depot set get the new keys they are entitled to.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isMySql, strList } from "@/lib/dialect";
import { DEPOT_ROLE } from "@/lib/depot";
import { createBusiness } from "@/server/services/bootstrap";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;
const migration = () =>
  readFileSync(join(process.cwd(), "prisma", ...(isMySql() ? ["mysql"] : []), "migrations", "20261018200000_depot_permissions_v2", "migration.sql"), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("UPDATE"));

run("depot permission upgrade (migration)", () => {
  let businessId: string;
  const roles: Record<string, string> = {};
  const perms = async (k: string) => strList((await prisma.role.findUniqueOrThrow({ where: { id: roles[k] } })).permissions).sort();

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: "Up", email: `up${Date.now()}@test.local`, passwordHash: "x" } });
    businessId = (await prisma.$transaction((tx) => createBusiness(tx, { name: "আপগ্রেড ডিপো", ownerUserId: u.id, businessType: "DEPOT" }))).id;
    const make = async (name: string, permissions: string[]) => (roles[name] = (await prisma.role.create({ data: { businessId, name, permissions } })).id);
    await make("old-full", ["depot:view", "depot:delivery_manage", "depot:stock_in", "depot:collection_create", "depot:reports_view", "depot:scheme_manage"]);
    await make("stock-only", ["depot:stock_in", "dashboard:view"]);
    await make("viewer", ["depot:view"]);
    await make("general", ["sales:view", "reports:view"]);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("adds exactly the keys each old key used to include — and is safe to run twice", async () => {
    for (let pass = 0; pass < 2; pass++) for (const sql of migration()) await prisma.$executeRawUnsafe(sql);
    expect(await perms("old-full")).toEqual([...DEPOT_ROLE.permissions].sort()); // all 13, no duplicates
    expect(await perms("stock-only")).toEqual(["dashboard:view", "depot:company_ledger", "depot:company_payment", "depot:stock_adjust", "depot:stock_in"]);
    expect(await perms("viewer")).toEqual(["depot:register_view", "depot:view"]);
    expect(await perms("general")).toEqual(["reports:view", "sales:view"]); // untouched
  });

  it("new depot businesses get the depot role with the full set", async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { businessId, name: DEPOT_ROLE.name } });
    expect(strList(role.permissions).sort()).toEqual([...DEPOT_ROLE.permissions].sort());
  });
});
