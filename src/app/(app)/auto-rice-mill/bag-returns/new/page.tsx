import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { saveBagReturnAction } from "@/server/actions/bag-return";
import { getSupplierBagBalance } from "@/server/services/bag-tracking";
import { BagReturnForm } from "../bag-return-form";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "নতুন খালি বস্তা ফেরত চালান" };

export default async function NewBagReturnPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("auto_rice_mill:bag_return:create");
  const p = await readParams(searchParams);
  const preselectedSupplierId = p.supplierId;

  let initialSupplier = null;
  let initialBalance = null;

  if (preselectedSupplierId) {
    const s = await prisma.supplier.findFirst({
      where: {
        businessId: ctx.business.id,
        OR: [{ id: preselectedSupplierId }, { accountId: preselectedSupplierId }],
      },
      include: { account: true },
    });
    if (s) {
      initialSupplier = {
        id: s.id,
        name: s.name,
        group: s.account.name,
        mobile: s.mobile ?? undefined,
      };
      initialBalance = await getSupplierBagBalance(ctx.business.id, s.id);
    }
  }

  return (
    <>
      <PageHeader
        title="নতুন খালি বস্তা ফেরত চালান"
        description="ধান সরবরাহকারীকে খালি চটের ও প্লাস্টিক বস্তা ফেরত দেওয়ার ভাউচার তৈরি করুন"
        crumbs={[
          { label: "অটো রাইস মিল", href: "/purchases/paddy" },
          { label: "খালি বস্তা ফেরত", href: "/auto-rice-mill/bag-returns" },
          { label: "নতুন ফেরত চালান" },
        ]}
      />
      <section className="panel p-5">
        <BagReturnForm
          action={saveBagReturnAction.bind(null, null)}
          dateLocked={!canChangeEntryDate(ctx)}
          initialBalance={initialBalance}
          defaults={{
            date: toDateInput(),
            supplier: initialSupplier,
            returnedJuteBags: "",
            returnedPlasticBags: "",
            driverName: "",
            vehicleNo: "",
            note: "",
          }}
        />
      </section>
    </>
  );
}
