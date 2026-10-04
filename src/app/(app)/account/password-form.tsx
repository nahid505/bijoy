"use client";

import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { changePasswordAction, updateProfileAction, updateSecurityPrefsAction } from "@/server/actions/auth";

export function ProfileForm({ name, mobile }: { name: string; mobile?: string | null }) {
  return (
    <ActionForm action={updateProfileAction} className="space-y-3">
      <Field label="নাম" name="name">
        <input id="name" name="name" defaultValue={name} className="input" />
      </Field>
      <Field label="মোবাইল নম্বর" name="mobile" hint="লগইন, পাসওয়ার্ড রিসেট ও নিরাপত্তা এসএমএসের জন্য">
        <input id="mobile" name="mobile" type="tel" defaultValue={mobile ?? ""} className="input" placeholder="01XXXXXXXXX" />
      </Field>
      <SubmitButton>প্রোফাইল সংরক্ষণ</SubmitButton>
    </ActionForm>
  );
}

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="space-y-3">
      <Field label="বর্তমান পাসওয়ার্ড" name="currentPassword">
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" className="input" />
      </Field>
      <Field label="নতুন পাসওয়ার্ড" name="newPassword" hint="কমপক্ষে ৮ অক্ষর">
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" className="input" />
      </Field>
      <Field label="নতুন পাসওয়ার্ড নিশ্চিত করুন" name="confirmPassword">
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" className="input" />
      </Field>
      <SubmitButton>পাসওয়ার্ড পরিবর্তন করুন</SubmitButton>
    </ActionForm>
  );
}

export function SecurityPrefsForm({ loginOtpEnabled, loginAlertEnabled, smsAvailable, hasMobile }: { loginOtpEnabled: boolean; loginAlertEnabled: boolean; smsAvailable: boolean; hasMobile: boolean }) {
  return (
    <ActionForm action={updateSecurityPrefsAction} className="space-y-3 text-sm">
      {!hasMobile && <p className="text-xs text-amber-700">এসএমএস নিরাপত্তা ব্যবহার করতে আগে প্রোফাইলে মোবাইল নম্বর দিন।</p>}
      {!smsAvailable && <p className="text-xs text-slate-500">সার্ভারে এসএমএস কনফিগার করা নেই — এই সুবিধাগুলো এখন কাজ করবে না।</p>}
      <label className="flex items-start gap-2">
        <input type="checkbox" name="loginOtpEnabled" defaultChecked={loginOtpEnabled} disabled={!smsAvailable || !hasMobile} className="mt-1" />
        <span>লগইনে এসএমএস কোড (২-ধাপ যাচাই)<span className="block text-xs text-slate-500">পাসওয়ার্ডের পর মোবাইলে পাঠানো ৬ অঙ্কের কোড লাগবে</span></span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="loginAlertEnabled" defaultChecked={loginAlertEnabled} disabled={!hasMobile} className="mt-1" />
        <span>নতুন লগইন হলে এসএমএস সতর্কতা<span className="block text-xs text-slate-500">আপনার অ্যাকাউন্টে কেউ ঢুকলে সাথে সাথে জানবেন</span></span>
      </label>
      <SubmitButton>সংরক্ষণ</SubmitButton>
    </ActionForm>
  );
}
