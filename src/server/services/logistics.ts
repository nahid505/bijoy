import "server-only";
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { UserError } from "@/lib/errors";
import { nextVoucherNo, writeEntries } from "./accounting";
import { paymentEntries } from "@/lib/accounting";
import type { TripPaymentStatus } from "@prisma/client";

export interface SaveCompanyVehicleInput {
  vehicleNo: string;
  model?: string | null;
  driverName?: string | null;
  driverMobile?: string | null;
  isActive?: boolean;
}

export async function getCompanyVehicles(businessId: string, onlyActive = true) {
  return prisma.companyVehicle.findMany({
    where: { businessId, ...(onlyActive ? { isActive: true } : {}) },
    orderBy: { vehicleNo: "asc" },
  });
}

export async function saveCompanyVehicle(
  businessId: string,
  input: SaveCompanyVehicleInput,
  id?: string,
) {
  const vehicleNo = input.vehicleNo.trim();
  if (!vehicleNo) throw new UserError("গাড়ির নম্বর দিন");

  const existing = await prisma.companyVehicle.findFirst({
    where: {
      businessId,
      vehicleNo,
      ...(id ? { id: { not: id } } : {}),
    },
  });
  if (existing) throw new UserError(`"${vehicleNo}" নম্বরের গাড়ি ইতিমধ্যে সংরক্ষিত রয়েছে`);

  if (id) {
    return prisma.companyVehicle.update({
      where: { id, businessId },
      data: {
        vehicleNo,
        model: input.model?.trim() || null,
        driverName: input.driverName?.trim() || null,
        driverMobile: input.driverMobile?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });
  }

  return prisma.companyVehicle.create({
    data: {
      businessId,
      vehicleNo,
      model: input.model?.trim() || null,
      driverName: input.driverName?.trim() || null,
      driverMobile: input.driverMobile?.trim() || null,
      isActive: input.isActive ?? true,
    },
  });
}

export async function deleteCompanyVehicle(businessId: string, id: string) {
  const count = await prisma.driverTrip.count({ where: { vehicleId: id } });
  if (count > 0) {
    // If vehicle has trips, soft-deactivate instead
    return prisma.companyVehicle.update({
      where: { id, businessId },
      data: { isActive: false },
    });
  }
  return prisma.companyVehicle.delete({ where: { id, businessId } });
}

export async function getUniqueDrivers(businessId: string) {
  const [trips, vehicles] = await Promise.all([
    prisma.driverTrip.findMany({
      where: { businessId },
      select: { driverName: true, driverMobile: true },
      distinct: ["driverName"],
      orderBy: { driverName: "asc" },
    }),
    prisma.companyVehicle.findMany({
      where: { businessId, driverName: { not: null } },
      select: { driverName: true, driverMobile: true },
      orderBy: { driverName: "asc" },
    }),
  ]);

  const map = new Map<string, { driverName: string; driverMobile: string | null }>();
  for (const v of vehicles) {
    if (v.driverName?.trim()) {
      map.set(v.driverName.trim(), { driverName: v.driverName.trim(), driverMobile: v.driverMobile?.trim() || null });
    }
  }
  for (const t of trips) {
    if (t.driverName?.trim()) {
      const existing = map.get(t.driverName.trim());
      if (!existing || (!existing.driverMobile && t.driverMobile)) {
        map.set(t.driverName.trim(), { driverName: t.driverName.trim(), driverMobile: t.driverMobile?.trim() || null });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.driverName.localeCompare(b.driverName, "bn"));
}

export interface DriverTripsFilter {
  driverName?: string | null;
  paymentStatus?: TripPaymentStatus;
  page?: number;
  limit?: number;
}

export async function getDriverTripsSummary(businessId: string, driverName?: string | null) {
  const where = {
    businessId,
    ...(driverName ? { driverName } : {}),
  };

  const [tripAgg, payAgg, totalTrips] = await Promise.all([
    prisma.driverTrip.aggregate({
      where,
      _sum: { tripFare: true, paidAmount: true },
    }),
    prisma.driverTripPayment.aggregate({
      where,
      _sum: { amount: true },
    }),
    prisma.driverTrip.count({ where }),
  ]);

  const totalEarned = round2(Number(tripAgg._sum.tripFare ?? 0));
  const totalPaid = round2(Number(payAgg._sum.amount ?? (tripAgg._sum.paidAmount ?? 0)));
  const due = Math.max(0, round2(totalEarned - totalPaid));

  return {
    totalTrips,
    totalEarned,
    totalPaid,
    due,
  };
}

export async function getDriverTrips(businessId: string, filter: DriverTripsFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const limit = Math.max(1, Math.min(100, filter.limit ?? 30));
  const skip = (page - 1) * limit;

  const where = {
    businessId,
    ...(filter.driverName ? { driverName: filter.driverName } : {}),
    ...(filter.paymentStatus ? { paymentStatus: filter.paymentStatus } : {}),
  };

  const [trips, totalCount] = await Promise.all([
    prisma.driverTrip.findMany({
      where,
      include: {
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            type: true,
            partyAccount: { select: { name: true } },
          },
        },
        vehicle: {
          select: {
            id: true,
            vehicleNo: true,
          },
        },
      },
      orderBy: { date: "desc" },
      take: limit,
      skip,
    }),
    prisma.driverTrip.count({ where }),
  ]);

  return {
    trips,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    page,
  };
}

export interface PayDriverFareInput {
  driverName: string;
  driverMobile?: string | null;
  amount: number;
  cashAccountId: string;
  date: Date;
  reference?: string | null;
  notes?: string | null;
}

export async function payDriverFare(
  businessId: string,
  userId: string,
  input: PayDriverFareInput,
) {
  const amount = round2(input.amount);
  if (amount <= 0) throw new UserError("পরিশোধের পরিমাণ ০ এর বেশি হতে হবে");

  const driverName = input.driverName.trim();
  if (!driverName) throw new UserError("ড্রাইভারের নাম দিন");

  return prisma.$transaction(async (tx) => {
    // 1. Verify cash/bank account
    const cashAccount = await tx.account.findFirst({
      where: { id: input.cashAccountId, businessId, kind: { in: ["CASH", "BANK"] } },
    });
    if (!cashAccount) throw new UserError("সঠিক নগদ/ব্যাংক হিসাব নির্বাচন করুন");

    // 2. Find or create transport expense ledger
    let transportAccount = await tx.account.findFirst({
      where: {
        businessId,
        OR: [
          { systemKey: "TRANSPORT" },
          { name: "পরিবহন খরচ" },
        ],
      },
    });

    if (!transportAccount) {
      // Find indirect expenses group
      let expenseGroup = await tx.accountGroup.findFirst({
        where: { businessId, OR: [{ systemKey: "INDIRECT_EXPENSES" }, { nature: "EXPENSE" }] },
      });
      if (!expenseGroup) {
        expenseGroup = await tx.accountGroup.create({
          data: {
            businessId,
            name: "পরিচালন ব্যয়",
            nature: "EXPENSE",
            systemKey: "INDIRECT_EXPENSES",
            sortOrder: 51,
          },
        });
      }
      transportAccount = await tx.account.create({
        data: {
          businessId,
          groupId: expenseGroup.id,
          nature: "EXPENSE",
          name: "পরিবহন খরচ",
          code: "5204",
          systemKey: "TRANSPORT",
        },
      });
    }

    // 3. Create PAYMENT voucher
    const narration = input.notes?.trim() || `ড্রাইভার ট্রিপ ভাড়া পরিশোধ — ${driverName}`;
    const voucherNo = await nextVoucherNo(tx, businessId, "PAYMENT");

    const voucher = await tx.voucher.create({
      data: {
        businessId,
        type: "PAYMENT",
        book: "GENERAL",
        voucherNo,
        date: input.date,
        reference: input.reference?.trim() || null,
        narration,
        cashAccountId: cashAccount.id,
        amount,
        paidAmount: amount,
        createdById: userId,
      },
    });

    const entries = paymentEntries(cashAccount.id, [{ accountId: transportAccount.id, amount, narration }]);
    await writeEntries(tx, voucher, entries);

    // 4. FIFO update on driver's pending/partial trips
    const pendingTrips = await tx.driverTrip.findMany({
      where: {
        businessId,
        driverName,
        paymentStatus: { in: ["PENDING", "PARTIAL"] },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    let remaining = amount;
    for (const trip of pendingTrips) {
      if (remaining <= 0) break;
      const tripFare = Number(trip.tripFare);
      const currentPaid = Number(trip.paidAmount);
      const due = round2(tripFare - currentPaid);
      if (due <= 0) {
        await tx.driverTrip.update({
          where: { id: trip.id },
          data: { paymentStatus: "PAID" },
        });
        continue;
      }
      const allocate = round2(Math.min(remaining, due));
      const newPaid = round2(currentPaid + allocate);
      const newStatus = newPaid >= tripFare ? "PAID" : "PARTIAL";
      await tx.driverTrip.update({
        where: { id: trip.id },
        data: {
          paidAmount: newPaid,
          paymentStatus: newStatus,
        },
      });
      remaining = round2(remaining - allocate);
    }

    // 5. Create DriverTripPayment record
    const payment = await tx.driverTripPayment.create({
      data: {
        businessId,
        voucherId: voucher.id,
        driverName,
        driverMobile: input.driverMobile?.trim() || null,
        amount,
        date: input.date,
        cashAccountId: cashAccount.id,
        reference: input.reference?.trim() || null,
        notes: narration,
        createdById: userId,
      },
    });

    return { voucher, payment };
  });
}
