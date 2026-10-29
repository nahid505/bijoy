// Depot dealer: shop / business name (Customer.name) and proprietor (Customer.ownerName), shown "shop (owner)".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { partySchema } from "@/lib/validation";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { searchParties } from "@/server/lookup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const party = (name: string, extra: Record<string, unknown> = {}) => partySchema.parse({ name, ...extra });

run("depot dealer: business name and owner name", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Owner", email: `owner${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "ডিপো", ownerUserId: user.id, businessType: "DEPOT" }));
    ctx = { businessId: business.id, userId: user.id };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves both names; the dealer's ledger reads 'shop (owner)'", async () => {
    const d = await saveParty(ctx, "CUSTOMER", party("মেসার্স রহমান ট্রেডার্স", { ownerName: "মোঃ আব্দুর রহমান" }), undefined, { dealer: true });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: d.id }, include: { account: true } });
    expect(c.name).toBe("মেসার্স রহমান ট্রেডার্স");
    expect(c.ownerName).toBe("মোঃ আব্দুর রহমান");
    expect(c.account.name).toBe("মেসার্স রহমান ট্রেডার্স (মোঃ আব্দুর রহমান)");
  });

  it("no owner → just the shop name; editing the owner renames the ledger; an edit without the field keeps it", async () => {
    const d = await saveParty(ctx, "CUSTOMER", party("করিম স্টোর"), undefined, { dealer: true });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: d.accountId } })).name).toBe("করিম স্টোর");
    await saveParty(ctx, "CUSTOMER", party("করিম স্টোর", { ownerName: "আব্দুল করিম" }), d.id);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: d.accountId } })).name).toBe("করিম স্টোর (আব্দুল করিম)");
    const { ownerName: _, ...noOwner } = party("করিম জেনারেল স্টোর"); // a form without the owner field
    await saveParty(ctx, "CUSTOMER", noOwner, d.id);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: d.id }, include: { account: true } });
    expect(c.ownerName).toBe("আব্দুল করিম");
    expect(c.account.name).toBe("করিম জেনারেল স্টোর (আব্দুল করিম)");
  });

  it("general customers keep their plain ledger name", async () => {
    const g = await saveParty(ctx, "CUSTOMER", party("সাধারণ কাস্টমার"));
    expect((await prisma.account.findUniqueOrThrow({ where: { id: g.accountId } })).name).toBe("সাধারণ কাস্টমার");
  });

  it("the dealer picker shows 'shop (owner)' and finds a dealer by the owner's name", async () => {
    const byShop = await searchParties(ctx.businessId, "CUSTOMER", "রহমান ট্রেডার্স", { dealer: true });
    expect(byShop.map((p) => p.name)).toContain("মেসার্স রহমান ট্রেডার্স (মোঃ আব্দুর রহমান)");
    const byOwner = await searchParties(ctx.businessId, "CUSTOMER", "আব্দুর রহমান", { dealer: true });
    expect(byOwner.map((p) => p.name)).toEqual(["মেসার্স রহমান ট্রেডার্স (মোঃ আব্দুর রহমান)"]);
  });
});
