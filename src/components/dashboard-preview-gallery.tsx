"use client";

import { useState } from "react";

const TABS = [
  { id: "dashboard", label: "ড্যাশবোর্ড" },
  { id: "pos", label: "পিওএস বিক্রয়" },
  { id: "reports", label: "লেজার ও রিপোর্ট" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function DashboardPreviewGallery() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");

  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      {/* Ambient background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-3 sm:-inset-6 rounded-3xl bg-gradient-to-tr from-brand-500/25 via-emerald-500/15 to-teal-400/20 blur-2xl sm:blur-3xl -z-10"
      />

      {/* Perspective wrapper */}
      <div className="relative py-2 sm:py-4 [perspective:1200px]">
        {/* Main Glassmorphic Window Mockup */}
        <div className="relative rounded-2xl border border-slate-700/60 bg-slate-900/90 p-4 sm:p-5 shadow-2xl backdrop-blur-xl transition-all duration-500 [transform:rotateX(2deg)_rotateY(-3deg)] hover:[transform:rotateX(0deg)_rotateY(0deg)]">
          {/* Window Chrome Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-500/90 inline-block shadow-xs" />
              <span className="h-3 w-3 rounded-full bg-amber-500/90 inline-block shadow-xs" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/90 inline-block shadow-xs" />
              <span className="ml-2 hidden rounded-md bg-slate-800/80 px-2.5 py-0.5 text-[11px] font-mono text-slate-400 sm:inline-block">
                app.bijoylenden.com
              </span>
            </div>

            {/* Quick Screen Switcher Tabs */}
            <div className="flex items-center rounded-lg bg-slate-800/80 p-0.5 text-xs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                    activeTab === t.id
                      ? "bg-brand-600 text-white shadow-xs"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Live badge */}
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              লাইভ ড্যাশবোর্ড
            </span>
          </div>

          {/* TAB 1: MAIN DASHBOARD */}
          {activeTab === "dashboard" && (
            <div className="mt-3.5 space-y-3">
              {/* 3 KPI metric tiles */}
              <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
                <div className="rounded-xl border border-slate-800/90 bg-slate-800/50 p-2.5 sm:p-3">
                  <p className="text-[11px] font-medium text-slate-400">আজকের বিক্রি</p>
                  <p className="mt-1 text-sm sm:text-base font-bold text-white tabular-nums">৳ ৪৮,৫৫০</p>
                  <p className="mt-0.5 text-[10px] font-medium text-emerald-400">↑ ১২.৫% বৃদ্ধি</p>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-slate-800/50 p-2.5 sm:p-3">
                  <p className="text-[11px] font-medium text-slate-400">ক্যাশ ও ব্যাংক</p>
                  <p className="mt-1 text-sm sm:text-base font-bold text-emerald-300 tabular-nums">৳ ১,৮৫,২০০</p>
                  <p className="mt-0.5 text-[10px] font-medium text-slate-400">ব্যালেন্স প্রস্তুত</p>
                </div>
                <div className="rounded-xl border border-slate-800/90 bg-slate-800/50 p-2.5 sm:p-3">
                  <p className="text-[11px] font-medium text-slate-400">কাস্টমার বাকি</p>
                  <p className="mt-1 text-sm sm:text-base font-bold text-amber-300 tabular-nums">৳ ১,২৫,৪০০</p>
                  <p className="mt-0.5 text-[10px] font-medium text-amber-400/80">বকেয়া আদায়</p>
                </div>
              </div>

              {/* Weekly visual chart mockup */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-800/30 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">সাপ্তাহিক বিক্রয় ও আদায়</span>
                  <span className="text-[11px] text-slate-400">গত ৭ দিন</span>
                </div>
                <div className="mt-3 flex h-16 items-end justify-between gap-2 px-1 pt-2">
                  {[
                    { day: "শনি", h: "45%", val: "৳৩২K" },
                    { day: "রবি", h: "60%", val: "৳৪২K" },
                    { day: "সোম", h: "40%", val: "৳২৮K" },
                    { day: "মঙ্গল", h: "75%", val: "৳৫১K" },
                    { day: "বুধ", h: "65%", val: "৳৪৫K" },
                    { day: "বৃহঃ", h: "85%", val: "৳৫৮K" },
                    { day: "শুক্র", h: "100%", val: "৳৬৪K", active: true },
                  ].map((bar, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div className="w-full rounded-t-md bg-slate-800/60 h-14 flex items-end">
                        <div
                          style={{ height: bar.h }}
                          className={`w-full rounded-t-md transition-all ${
                            bar.active
                              ? "bg-gradient-to-t from-brand-600 to-emerald-400 shadow-xs shadow-emerald-500/50"
                              : "bg-gradient-to-t from-slate-700 to-slate-500"
                          }`}
                        />
                      </div>
                      <span className="text-[9px] text-slate-400">{bar.day}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Transactions List */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-800/40 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/10 text-emerald-400">🧾</span>
                    <div>
                      <p className="font-semibold text-slate-200">মেসার্স রহমান ট্রেডার্স</p>
                      <p className="text-[10px] text-slate-400">বিক্রয় ভাউচার #১০৫৮</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-white tabular-nums">৳ ১২,৫০০</p>
                    <span className="text-[10px] font-semibold text-emerald-400">পরিশোধিত</span>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-800/40 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-blue-500/10 text-blue-400">💵</span>
                    <div>
                      <p className="font-semibold text-slate-200">আল-আমিন জেনারেল স্টোর</p>
                      <p className="text-[10px] text-slate-400">নগদ আদায় রসিদ #৭৪২</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-white tabular-nums">৳ ৮,২০০</p>
                    <span className="text-[10px] font-semibold text-blue-400">নগদ জমা</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: POS COUNTER PREVIEW */}
          {activeTab === "pos" && (
            <div className="mt-3.5 space-y-3">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
                <div className="flex items-center justify-between border-b border-emerald-800/40 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🛒</span>
                    <div>
                      <p className="text-xs font-bold text-emerald-300">পিওএস দ্রুত বিক্রয়</p>
                      <p className="text-[10px] text-slate-400">বারকোড ও ক্যাশ মেমো</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    কাউন্টার ১
                  </span>
                </div>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-200">
                    <span>মিনিকেট চাল ৫০ কেজি</span>
                    <span className="font-bold text-white tabular-nums">৳ ৩,২৫০</span>
                  </div>
                  <div className="flex justify-between text-slate-200">
                    <span>সয়াবিন তেল ৫ লিটার</span>
                    <span className="font-bold text-white tabular-nums">৳ ৯২০</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-2 text-sm font-bold text-white">
                    <span>মোট আদায় (নগদ)</span>
                    <span className="text-emerald-400 tabular-nums">৳ ৪,১৭০</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2 text-xs">
                <span className="text-slate-300">রসিদ প্রিন্ট ও ড্রয়ার ওপেন</span>
                <span className="rounded bg-brand-600 px-2 py-1 text-[11px] font-bold text-white">
                  প্রিন্ট রেডি
                </span>
              </div>
            </div>
          )}

          {/* TAB 3: LEDGER & REPORTS PREVIEW */}
          {activeTab === "reports" && (
            <div className="mt-3.5 space-y-3">
              <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-3">
                <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
                  <p className="text-xs font-bold text-white">মাসিক লাভ-ক্ষতি ও স্টক</p>
                  <span className="text-[10px] font-semibold text-emerald-400">এই মাস</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-900/60 p-2.5">
                    <p className="text-[10px] text-slate-400">নিট মুনাফা</p>
                    <p className="text-sm font-bold text-white tabular-nums">৳ ১,৫৫,০০০</p>
                    <p className="text-[10px] text-emerald-400 font-semibold">মার্জিন ২২.৪%</p>
                  </div>
                  <div className="rounded-lg bg-slate-900/60 p-2.5">
                    <p className="text-[10px] text-slate-400">মোট স্টক মূল্য</p>
                    <p className="text-sm font-bold text-white tabular-nums">৳ ১৮,৪০,০০০</p>
                    <p className="text-[10px] text-brand-300 font-semibold">৪৮২টি পণ্য</p>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-slate-400">
                  ✔ ডাবল-এন্ট্রি হিসাব স্বয়ংক্রিয় পোস্ট সম্পন্ন
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Floating Overlapping Card 1: Top-Right (POS Quick Bill) */}
        <div className="hidden sm:block absolute -top-3 -right-3 w-52 rounded-xl border border-emerald-500/40 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-xl [transform:rotate(3deg)_translateZ(30px)] hover:[transform:rotate(0deg)_translateZ(40px)] transition-all duration-300">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300">
              <span>🛒</span> পিওএস দ্রুত বিক্রয়
            </span>
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
              প্রিন্ট রেডি
            </span>
          </div>
          <div className="mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between text-slate-300">
              <span className="truncate pr-1">মিনিকেট চাল ৫০ কেজি</span>
              <span className="font-semibold text-white tabular-nums">৳ ৩,২৫০</span>
            </div>
            <div className="flex justify-between border-t border-slate-800/80 pt-1 text-xs font-bold text-white">
              <span>মোট পরিশোধ (নগদ)</span>
              <span className="text-emerald-400 tabular-nums">৳ ৩,২৫০</span>
            </div>
          </div>
        </div>

        {/* Floating Overlapping Card 2: Bottom-Left (Financial Health) */}
        <div className="hidden sm:block absolute -bottom-3 -left-3 w-52 rounded-xl border border-brand-500/40 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-xl [transform:rotate(-3deg)_translateZ(25px)] hover:[transform:rotate(0deg)_translateZ(35px)] transition-all duration-300">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="flex items-center gap-1 text-[11px] font-bold text-white">
              <span>📊</span> মাসিক লাভ-ক্ষতি ও স্টক
            </span>
            <span className="text-[9px] font-semibold text-emerald-400">এই মাস</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-slate-400">নিট মুনাফা</p>
              <p className="text-xs font-bold text-white tabular-nums">৳ ১,৫৫,০০০</p>
            </div>
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
              মার্জিন ২২.৪%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
