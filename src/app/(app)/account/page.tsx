import type { Metadata } from "next";
import { DetailRow, PageHeader } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { prisma } from "@/lib/db";
import { otpAvailable } from "@/server/sms/otp";
import { ChangePasswordForm, ProfileForm, SecurityPrefsForm } from "./password-form";

export const metadata: Metadata = { title: "অ্যাকাউন্ট সেটিং" };

export default async function AccountPage() {
  const ctx = await requireContext();
  const prefs = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { loginOtpEnabled: true, loginAlertEnabled: true } });
  return (
    <>
      <PageHeader title="অ্যাকাউন্ট সেটিং" description="আপনার প্রোফাইল ও লগইন নিরাপত্তা" />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">প্রোফাইল</h2></div>
          <div className="p-4">
            <dl className="mb-4 divide-y divide-rule">
              <DetailRow label="মোবাইল">{ctx.user.mobile ?? "—"}</DetailRow>
              <DetailRow label="ইমেইল">{ctx.user.email ?? "—"}</DetailRow>
              <DetailRow label="বর্তমান ব্যবসা">{ctx.business.name}</DetailRow>
              <DetailRow label="রোল">{ctx.roleName}</DetailRow>
              <DetailRow label="সদস্য ব্যবসা">{ctx.businesses.map((b) => b.name).join(", ")}</DetailRow>
            </dl>
            <ProfileForm name={ctx.user.name} mobile={ctx.user.mobile} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">পাসওয়ার্ড পরিবর্তন</h2></div>
          <div className="p-4"><ChangePasswordForm /></div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">লগইন নিরাপত্তা</h2></div>
          <div className="p-4"><SecurityPrefsForm loginOtpEnabled={prefs.loginOtpEnabled} loginAlertEnabled={prefs.loginAlertEnabled} smsAvailable={otpAvailable()} hasMobile={!!ctx.user.mobile} /></div>
        </section>
      </div>
    </>
  );
}
