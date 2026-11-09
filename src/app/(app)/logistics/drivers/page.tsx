import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/server/auth";
import { accountOptions } from "@/server/voucher-editor";
import { accountScopeWhere } from "@/server/party-scope";
import {
  getDriverTrips,
  getDriverTripsSummary,
  getUniqueDrivers,
  getCompanyVehicles,
} from "@/server/services/logistics";
import { DriverClient } from "./driver-client";

export const metadata: Metadata = {
  title: "ড্রাইভার ট্রিপ ট্র্যাকিং ও ভাড়া লেজার — বিজয় লেনদেন",
};

export default async function DriverLogisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ driver?: string; page?: string }>;
}) {
  const ctx = await getContext();
  if (!ctx) return null;

  const sp = await searchParams;
  const driverName = sp.driver?.trim() || "";
  const page = Number(sp.page) || 1;

  const [summary, tripsData, uniqueDrivers, companyVehicles, paymentAccounts] = await Promise.all([
    getDriverTripsSummary(ctx.business.id, driverName || null),
    getDriverTrips(ctx.business.id, {
      driverName: driverName || null,
      page,
      limit: 30,
    }),
    getUniqueDrivers(ctx.business.id),
    getCompanyVehicles(ctx.business.id, false),
    accountOptions(
      ctx.business.id,
      { kind: { in: ["CASH", "BANK"] }, ...accountScopeWhere(ctx) },
      true,
      false,
      "GENERAL",
    ),
  ]);

  const serializedTrips = tripsData.trips.map((t) => ({
    ...t,
    totalQuantity: t.totalQuantity ? Number(t.totalQuantity) : null,
    tripFare: Number(t.tripFare),
    paidAmount: Number(t.paidAmount),
  }));

  return (
    <>
      <PageHeader
        title="ড্রাইভার ট্রিপ ট্র্যাকিং ও পরিবহন ভাড়া"
        description="ক্রয় ও বিক্রয় চালানের পরিবহন তথ্য, গন্তব্য, অর্জিত ভাড়া ও ড্রাইভারের বকেয়া পরিশোধ ব্যবস্থাপনা"
        crumbs={[{ label: "লজিস্টিকস" }, { label: "ড্রাইভার ও ট্রিপ ট্র্যাকিং" }]}
      />

      <DriverClient
        summary={summary}
        trips={serializedTrips}
        uniqueDrivers={uniqueDrivers}
        companyVehicles={companyVehicles}
        paymentAccounts={paymentAccounts}
        selectedDriver={driverName}
        currency={ctx.business.currencySymbol}
        page={tripsData.page}
        totalPages={tripsData.totalPages}
      />
    </>
  );
}
