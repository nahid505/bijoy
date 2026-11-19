import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { requireContext } from "@/server/auth";
import { prisma } from "@/lib/db";
import { getRiceMillSettings, resolveMillRole } from "@/lib/custom-milling";
import { saveSettingsAction } from "@/server/actions/custom-milling";
import { CustomMillingTabs } from "../custom-milling-ui";
import { MillUserAssignmentSection } from "./user-assignment";

export const metadata: Metadata = {
  title: "কাস্টম মিলিং সেটিংস ও রেট কনফিগারেশন",
};

export default async function CustomMillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const settings = await getRiceMillSettings();
  const role = resolveMillRole(ctx, sp.role, settings);

  // RBAC: MILL_ACCOUNTANT has no access to settings
  if (role === "MILL_ACCOUNTANT") {
    return (
      <div className="space-y-6">
        <PageHeader title="কাস্টম মিলিং সেটিংস" description="প্রবেশাধিকার সংরক্ষিত" />
        <CustomMillingTabs role={role} />
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-red-900">
          <span className="text-4xl">🚫</span>
          <h2 className="mt-2 text-lg font-bold">অনুমতি নেই (Access Restricted)</h2>
          <p className="mt-1 text-sm text-red-700">
            মিলের সেটিংস, অংশীদারি ও চার্জের হার পরিবর্তনের অনুমতি শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান)-এর রয়েছে।
          </p>
        </div>
      </div>
    );
  }

  const isReadOnly = role === "MILL_PARTNER";

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      isSuperAdmin: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="কাস্টম মিলিং সেটিংস ও রেট কনফিগারেশন"
          description="স্ট্যান্ডার্ড ৭৫ কেজি হিসাব, ড্রায়ার রেট, মিলিং ফি ও পার্টনারশিপ কনফিগারেশন"
        />
      </div>

      <CustomMillingTabs role={role} />

      {isReadOnly && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900">
          ℹ️ আপনি <strong>পার্টনার ভিউ (Read-Only)</strong>-তে আছেন। সেটিংস শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান) পরিবর্তন করতে পারেন।
        </div>
      )}

      <div className="max-w-4xl">
        <ActionForm action={saveSettingsAction} className="space-y-6">
          {/* Section 1: Mill Profile */}
          <section className="panel p-5 sm:p-6 space-y-4">
            <div className="border-b border-rule pb-2">
              <h2 className="panel-title flex items-center gap-2">
                <span>🏭</span>
                <span>মিলের সাধারণ তথ্য (চালান ও রসিদে প্রদর্শিত)</span>
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="মিলের নাম" name="millName">
                <input
                  id="millName"
                  name="millName"
                  defaultValue={settings.millName}
                  disabled={isReadOnly}
                  className="input"
                  required
                />
              </Field>

              <Field label="মোবাইল / হেল্পলাইন নম্বর" name="millPhone">
                <input
                  id="millPhone"
                  name="millPhone"
                  defaultValue={settings.millPhone}
                  disabled={isReadOnly}
                  className="input"
                  required
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="মিলের ঠিকানা" name="millAddress">
                  <input
                    id="millAddress"
                    name="millAddress"
                    defaultValue={settings.millAddress}
                    disabled={isReadOnly}
                    className="input"
                    required
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* Section 2: 60:40 Joint Venture Setup */}
          <section className="panel p-5 sm:p-6 space-y-4">
            <div className="border-b border-rule pb-2">
              <h2 className="panel-title flex items-center gap-2">
                <span>🤝</span>
                <span>৬০:৪০ অংশীদারি কনফিগারেশন (Joint Venture)</span>
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="পার্টনার ১ এর নাম (মালিক)" name="partner1Name">
                <input
                  id="partner1Name"
                  name="partner1Name"
                  defaultValue={settings.partner1Name}
                  disabled={isReadOnly}
                  className="input font-bold"
                  required
                />
              </Field>

              <Field label="পার্টনার ১ এর শেয়ার % (ডিফল্ট ৬০%)" name="partner1SharePct">
                <input
                  id="partner1SharePct"
                  name="partner1SharePct"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={settings.partner1SharePct}
                  disabled={isReadOnly}
                  className="input-num font-bold text-amber-900"
                  required
                />
              </Field>

              <Field label="পার্টনার ২ এর নাম" name="partner2Name">
                <input
                  id="partner2Name"
                  name="partner2Name"
                  defaultValue={settings.partner2Name}
                  disabled={isReadOnly}
                  className="input font-bold"
                  required
                />
              </Field>

              <Field label="পার্টনার ২ এর শেয়ার % (ডিফল্ট ৪০%)" name="partner2SharePct">
                <input
                  id="partner2SharePct"
                  name="partner2SharePct"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={settings.partner2SharePct}
                  disabled={isReadOnly}
                  className="input-num font-bold text-blue-900"
                  required
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="মাসিক মিল ভাড়া (৳)" name="monthlyRent" hint="মিলের প্রতি মাসের ভাড়া যা খরচে পড়বে">
                  <input
                    id="monthlyRent"
                    name="monthlyRent"
                    type="number"
                    step="1"
                    defaultValue={settings.monthlyRent}
                    disabled={isReadOnly}
                    className="input-num font-bold text-slate-800"
                    required
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* Section: User and Role Assignment (Accountant & Partner) */}
          <MillUserAssignmentSection
            users={users}
            initialAccountantId={settings.accountantUserId}
            initialPartnerId={settings.partnerUserId}
            isReadOnly={isReadOnly}
          />

          {/* Section 3: Bag Calculation & Standard Formula */}
          <section className="panel p-5 sm:p-6 space-y-4">
            <div className="border-b border-rule pb-2">
              <h2 className="panel-title flex items-center gap-2">
                <span>⚖️</span>
                <span>ওজন স্কেল ও স্ট্যান্ডার্ড বস্তা হিসাব (75 KG Formula)</span>
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="স্ট্যান্ডার্ড বস্তার ওজন (Standard Bag KG)"
                name="bagStandardKg"
                hint="ডিফল্ট ৭৫ কেজি = ১ স্ট্যান্ডার্ড বস্তা"
              >
                <input
                  id="bagStandardKg"
                  name="bagStandardKg"
                  type="number"
                  step="0.1"
                  min="10"
                  defaultValue={settings.bagStandardKg}
                  disabled={isReadOnly}
                  className="input-num font-bold text-brand-700"
                  required
                />
              </Field>

              <Field
                label="ডিফল্ট ঢালতা কর্তন (KG প্রতি বস্তা)"
                name="defaultDhaltaPerBag"
                hint="ডিফল্ট ১.৫ কেজি প্রতি বস্তায় কর্তন"
              >
                <input
                  id="defaultDhaltaPerBag"
                  name="defaultDhaltaPerBag"
                  type="number"
                  step="0.1"
                  min="0"
                  defaultValue={settings.defaultDhaltaPerBag}
                  disabled={isReadOnly}
                  className="input-num font-bold text-slate-800"
                  required
                />
              </Field>
            </div>
          </section>

          {/* Section 4: Billing Rates */}
          <section className="panel p-5 sm:p-6 space-y-4">
            <div className="border-b border-rule pb-2">
              <h2 className="panel-title flex items-center gap-2">
                <span>💰</span>
                <span>ডিফল্ট বিলিং রেট ও উপজাত দর</span>
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="ড্রায়ার শুকানো রেট (৳ প্রতি ৭৫ কেজি বস্তা)"
                name="defaultDryerRate"
                hint="প্রতি স্ট্যান্ডার্ড বস্তা শুকানোর খরচ (ডিফল্ট ৳৫০)"
              >
                <input
                  id="defaultDryerRate"
                  name="defaultDryerRate"
                  type="number"
                  step="0.5"
                  min="0"
                  defaultValue={settings.defaultDryerRate}
                  disabled={isReadOnly}
                  className="input-num font-bold text-slate-800"
                  required
                />
              </Field>

              <Field
                label="মিলিং / মাড়াই রেট (৳ প্রতি ৭৫ কেজি বস্তা)"
                name="defaultMillingRate"
                hint="প্রতি স্ট্যান্ডার্ড বস্তা মিলিং চার্জ (ডিফল্ট ৳১২০)"
              >
                <input
                  id="defaultMillingRate"
                  name="defaultMillingRate"
                  type="number"
                  step="0.5"
                  min="0"
                  defaultValue={settings.defaultMillingRate}
                  disabled={isReadOnly}
                  className="input-num font-bold text-slate-800"
                  required
                />
              </Field>

              <Field
                label="কুঁড়া বিক্রয় দর (৳ প্রতি কেজি)"
                name="branRatePerKg"
                hint="মিল উপজাত কুঁড়া দর (ডিফল্ট ৳২২/কেজি)"
              >
                <input
                  id="branRatePerKg"
                  name="branRatePerKg"
                  type="number"
                  step="0.5"
                  min="0"
                  defaultValue={settings.branRatePerKg}
                  disabled={isReadOnly}
                  className="input-num font-bold text-slate-800"
                  required
                />
              </Field>

              <Field
                label="ভূসি বিক্রয় দর (৳ প্রতি কেজি)"
                name="huskRatePerKg"
                hint="মিল উপজাত ভূসি দর (ডিফল্ট ৳৮/কেজি)"
              >
                <input
                  id="huskRatePerKg"
                  name="huskRatePerKg"
                  type="number"
                  step="0.5"
                  min="0"
                  defaultValue={settings.huskRatePerKg}
                  disabled={isReadOnly}
                  className="input-num font-bold text-slate-800"
                  required
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="চালানের নিচের ফুটনোট" name="invoiceFooterNote">
                  <textarea
                    id="invoiceFooterNote"
                    name="invoiceFooterNote"
                    rows={2}
                    defaultValue={settings.invoiceFooterNote}
                    disabled={isReadOnly}
                    className="input"
                    required
                  />
                </Field>
              </div>
            </div>
          </section>

          {!isReadOnly && (
            <div className="flex justify-end">
              <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">
                ✓ সেটিংস সংরক্ষণ করুন
              </SubmitButton>
            </div>
          )}
        </ActionForm>
      </div>
    </div>
  );
}
