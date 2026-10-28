// Mixed Bangla / English entry end to end: a form value goes through the shared form parser (formToObject) into
// validation and the database; names keep what was typed, numbers in any digit script become numbers; search finds
// a record by either digit script and ignores case.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { partySchema, productSchema } from "@/lib/validation";
import { formToObject } from "@/server/action-utils";
import { createBusiness } from "@/server/services/bootstrap";
import type { Ctx } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { searchAccounts, searchParties, searchProducts } from "@/server/lookup";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
};

run("mixed Bangla / English data entry", () => {
  let ctx: Ctx;
  let unitId: string;
  let rice: string;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: "Mixed", email: `mixed${Date.now()}@test.local`, passwordHash: "x" } });
    const b = await prisma.$transaction((tx) => createBusiness(tx, { name: "মিশ্র ইনপুট", ownerUserId: u.id }));
    ctx = { businessId: b.id, userId: u.id };
    unitId = (await prisma.unit.findFirstOrThrow({ where: { businessId: b.id, name: "পিস" } })).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a product: the mixed name is stored as typed; mixed-digit prices and stock become numbers", async () => {
    const fields = formToObject(form({ name: "Miniket চাল ৫০kg", code: "MK-৫০", barcode: "", categoryId: "", brandId: "", unitId, purchasePrice: "১২451৩৩", salePrice: "১,২৫০.৫০", wholesalePrice: "", minStock: "১০", openingStock: "৫", openingRate: "", password: "১২৩৪৫৬" }));
    expect(fields.password).toBe("১২৩৪৫৬"); // passwords are never rewritten
    expect([fields.name, fields.code, fields.purchasePrice, fields.salePrice, fields.minStock]).toEqual(["Miniket চাল ৫০kg", "MK-৫০", "1245133", "1250.50", "10"]);
    rice = await saveProduct(ctx, productSchema.parse({ ...fields, trackBatch: false }));
    const p = await prisma.product.findUniqueOrThrow({ where: { id: rice } });
    expect([p.name, Number(p.purchasePrice), Number(p.salePrice), Number(p.minStock), Number(p.stock)]).toEqual(["Miniket চাল ৫০kg", 1245133, 1250.5, 10, 5]);
  });

  it("a party: mixed name kept, a Bangla-digit mobile stored in English digits", async () => {
    const fields = formToObject(form({ name: "Aman ধান Traders ১০০", mobile: "০১৭১২-৩৪৫৬৭৮", email: "", address: "রোড 5, বাড়ি ১২", notes: "", openingBalance: "২,৫০০", creditLimit: "", creditDays: "৩০" }));
    const party = await saveParty(ctx, "CUSTOMER", partySchema.parse(fields));
    const c = await prisma.customer.findUniqueOrThrow({ where: { accountId: party.accountId } });
    expect([c.name, c.mobile, c.address, c.creditDays]).toEqual(["Aman ধান Traders ১০০", "01712-345678", "রোড 5, বাড়ি ১২", 30]); // digits English, the hyphen as typed
  });

  it("search: either digit script, any letter case, mixed text", async () => {
    for (const q of ["Miniket চাল ৫০kg", "miniket", "MINIKET", "চাল 50kg", "চাল ৫০", "50KG"]) {
      expect((await searchProducts(ctx.businessId, q)).map((p) => p.id), q).toContain(rice);
    }
    for (const q of ["aman ধান", "Traders 100", "traders ১০০", "০১৭১২৩৪৫৬৭৮", "01712345678"]) {
      expect((await searchParties(ctx.businessId, "CUSTOMER", q)).map((p) => p.name), q).toContain("Aman ধান Traders ১০০");
    }
    const acc = await searchAccounts(ctx.businessId, "traders 100");
    expect(acc.items.map((a) => a.name)).toContain("Aman ধান Traders ১০০");
  });
});
