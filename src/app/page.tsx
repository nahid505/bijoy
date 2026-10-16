import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT } from "@/lib/contact";
import { ProfileSection } from "@/components/profile-section";
import { getCurrentUser } from "@/server/auth";
import { loadPlans } from "@/server/billing/plans";
import { PricingSection } from "@/components/pricing-section";
import { PublicFooter, PublicHeader } from "@/components/public-site";
import { toBnDigits } from "@/lib/format";

export const metadata: Metadata = {
  title: "বিজয় লেনদেন — বাংলায় ব্যবসার হিসাব ও ইআরপি",
  description: "ডাবল-এন্ট্রি হিসাব, বিক্রয়-ক্রয়, স্টক, পিওএস, পে-রোল ও রিপোর্ট — সহজ বাংলায়, ক্লাউডে।",
};
export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: "📒", title: "ডাবল-এন্ট্রি হিসাব", text: "রসিদ, পেমেন্ট, জার্নাল — প্রতিটি লেনদেনে ডেবিট = ক্রেডিট নিশ্চিত। লেজার, ডে বুক, ট্রায়াল ব্যালেন্স।" },
  { icon: "🧾", title: "বিক্রয় ও ক্রয়", text: "ইনভয়েস, ফেরত, বাকি হিসাব ও কাস্টমার/সাপ্লায়ার লেজার — স্বয়ংক্রিয় ভাউচার সহ।" },
  { icon: "📦", title: "স্টক ও গুদাম", text: "একাধিক গুদাম, ব্যাচ ও মেয়াদোত্তীর্ণ পণ্যের সতর্কতা, স্টক ট্রান্সফার ও সমন্বয়।" },
  { icon: "🛒", title: "পিওএস", text: "দোকানের কাউন্টারে দ্রুত বিক্রি, বারকোড ও রসিদ প্রিন্ট।" },
  { icon: "💼", title: "পে-রোল ও এইচআর", text: "কর্মচারী, বেতন শিট, অগ্রিম ও বেতন পরিশোধ — হিসাবের খাতায় সরাসরি পোস্ট।" },
  { icon: "📊", title: "রিপোর্ট", text: "লাভ-ক্ষতি, ব্যালান্স শীট, বিক্রয় ও স্টক রিপোর্ট — প্রিন্ট ও এক্সপোর্ট।" },
  { icon: "🔐", title: "রোল ও অনুমতি", text: "মালিক, ম্যানেজার, হিসাবরক্ষক, বিক্রয়কর্মী — কে কী দেখবে ও করবে তা আপনি ঠিক করুন।" },
  { icon: "📱", title: "এসএমএস ও নোটিফিকেশন", text: "বাকি আদায়ের রিমাইন্ডার, কম স্টক ও মেয়াদের সতর্কতা।" },
];

const WHY = [
  { title: "সম্পূর্ণ বাংলায়", text: "মেনু, রিপোর্ট, সংখ্যা — সব বাংলায়। হিসাবের জ্ঞান না থাকলেও ব্যবহার সহজ।" },
  { title: "আপনার ডেটা আলাদা ও নিরাপদ", text: "প্রতিটি ব্যবসার ডেটা সম্পূর্ণ আলাদা রাখা হয়; নিয়মিত ব্যাকআপ ও অডিট লগ।" },
  { title: "যেকোনো ডিভাইসে", text: "মোবাইল, ট্যাবলেট বা কম্পিউটার — ব্রাউজার থেকেই কাজ করুন।" },
  { title: "মেয়াদ শেষেও ডেটা মুছে না", text: "সাবস্ক্রিপশন শেষ হলে শুধু পেইড ফিচার বন্ধ হয় — আপনার হিসাব সংরক্ষিত থাকে।" },
];

const FAQ = [
  { q: "ফ্রি ট্রায়ালে কি কার্ড বা পেমেন্ট লাগবে?", a: "না। রেজিস্ট্রেশন করলেই ট্রায়াল শুরু হয়; পছন্দ হলে পরে বিকাশ/নগদ বা অন্য মাধ্যমে পেমেন্ট করবেন।" },
  { q: "ট্রায়াল বা সাবস্ক্রিপশন শেষ হলে কী হবে?", a: "আপনার কোনো ডেটা মুছে যাবে না। ফ্রি প্ল্যানের ফিচারগুলো চালু থাকবে, বাকিগুলো রিনিউ করলেই আবার চালু হবে।" },
  { q: "একাধিক ব্যবহারকারী যোগ করা যাবে?", a: "হ্যাঁ — প্ল্যান অনুযায়ী নির্দিষ্ট সংখ্যক ব্যবহারকারী যোগ করতে পারবেন, প্রত্যেককে আলাদা রোল দিয়ে।" },
  { q: "প্ল্যান পরিবর্তন করা যায়?", a: "যেকোনো সময় আপগ্রেড বা ডাউনগ্রেড করতে পারবেন। প্রতিটি পেমেন্টের জন্য ইনভয়েস পাবেন।" },
  { q: "আমার ডেটা কি অন্য কেউ দেখতে পারবে?", a: "না। প্রতিটি ব্যবসার ডেটা আলাদা; শুধু আপনি যাদের অনুমতি দেবেন তারাই দেখতে পারবেন।" },
];

/** Static preview of the product (drawn with markup — no real customer data). */
function Preview({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <figure className="panel overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-rule bg-slate-50 px-3 py-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /><span className="h-2.5 w-2.5 rounded-full bg-green-300" />
      </div>
      <div className="p-4">
        <p className="mb-3 font-semibold text-ink-900">{title}</p>
        <ul className="space-y-1.5 text-sm">
          {rows.map(([a, b]) => <li key={a} className="flex justify-between border-b border-dashed border-rule pb-1.5"><span className="text-slate-600">{a}</span><span className="font-medium tabular-nums text-ink-900">{b}</span></li>)}
        </ul>
      </div>
      <figcaption className="sr-only">{title} — নমুনা</figcaption>
    </figure>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const cycle = (await searchParams).cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const [user, { plans, features, settings }] = await Promise.all([getCurrentUser(), loadPlans({ publicOnly: true, activeOnly: true })]);
  const trial = settings.trialDays;
  const email = process.env.PLATFORM_SUPPORT_EMAIL;
  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader loggedIn={!!user} />
      <main>
        {/* hero */}
        <section className="relative overflow-hidden bg-ink-900 text-white">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 28px)" }} />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
            <div>
              <h1 className="text-3xl font-bold leading-tight sm:text-4xl">ব্যবসার পুরো হিসাব,<br />সহজ বাংলায়।</h1>
              <p className="mt-4 text-lg text-ink-100">হিসাব, বিক্রয়-ক্রয়, স্টক, পিওএস, পে-রোল ও রিপোর্ট — এক জায়গায়। দোকান থেকে ডিস্ট্রিবিউটর, সব ধরনের ব্যবসার জন্য।</p>
              <div className="mt-7 flex flex-wrap gap-3">
                {user ? (
                  <Link prefetch={false} href="/dashboard" className="btn-primary px-5 py-2.5 text-base">ড্যাশবোর্ডে যান →</Link>
                ) : (
                  <>
                    <Link prefetch={false} href="/register" className="btn-primary px-5 py-2.5 text-base">{trial > 0 ? `${toBnDigits(trial)} দিন ফ্রি ট্রায়াল শুরু করুন` : "ফ্রি শুরু করুন"}</Link>
                    <Link prefetch={false} href="/pricing" className="rounded-md bg-white px-5 py-2.5 text-base font-semibold text-ink-900 hover:bg-brand-50">শুরু করুন (Get Started)</Link>
                    <Link prefetch={false} href="/login" className="rounded-md px-5 py-2.5 text-base font-medium text-white ring-1 ring-white/40 hover:bg-white/10">লগইন</Link>
                  </>
                )}
              </div>
              <p className="mt-3 text-sm text-ink-200">কার্ড লাগবে না · যেকোনো সময় বাতিল · ডেটা কখনো মুছে না</p>
            </div>
            <div className="hidden text-ink-900 md:block">
              <Preview title="আজকের সারসংক্ষেপ" rows={[["আজকের বিক্রি", "৳ ৪৮,৫৫০"], ["নগদ জমা", "৳ ৩২,১০০"], ["কাস্টমারের বাকি", "৳ ১,২৫,৪০০"], ["কম স্টক পণ্য", "৭টি"], ["৩০ দিনে মেয়াদ শেষ", "৩টি ব্যাচ"]]} />
            </div>
          </div>
        </section>

        {/* features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <h2 className="text-center text-2xl font-bold text-ink-900">যা যা পাচ্ছেন</h2>
          <p className="mt-2 text-center text-slate-600">প্রয়োজনমতো মডিউল চালু বা বন্ধ করুন</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="panel p-5">
                <span aria-hidden className="text-2xl">{f.icon}</span>
                <h3 className="mt-2 font-semibold text-ink-900">{f.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* screenshots */}
        <section aria-labelledby="shots" className="bg-white py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 id="shots" className="text-center text-2xl font-bold text-ink-900">এক নজরে</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <Preview title="লাভ-ক্ষতি (এই মাস)" rows={[["বিক্রয়", "৳ ৯,৮০,০০০"], ["বিক্রিত পণ্যের ব্যয়", "৳ ৭,১০,০০০"], ["পরিচালন ব্যয়", "৳ ১,১৫,০০০"], ["নিট লাভ", "৳ ১,৫৫,০০০"]]} />
              <Preview title="কাস্টমার লেজার" rows={[["০১ অক্টো · বিক্রয় #১০৪২", "৳ ১২,৫০০"], ["০৩ অক্টো · রসিদ", "− ৳ ১০,০০০"], ["০৫ অক্টো · বিক্রয় #১০৫৮", "৳ ৮,২০০"], ["বর্তমান বাকি", "৳ ১০,৭০০"]]} />
              <Preview title="স্টক অবস্থা" rows={[["মোট পণ্য", "৪৮২টি"], ["স্টক মূল্য", "৳ ১৮,৪০,০০০"], ["কম স্টক", "৭টি"], ["মেয়াদোত্তীর্ণ", "২টি ব্যাচ"]]} />
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">নমুনা সংখ্যা — উদাহরণ মাত্র</p>
          </div>
        </section>

        {/* free trial */}
        <section id="trial" aria-labelledby="trial-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-16">
          <div className="panel grid gap-6 p-6 md:grid-cols-[1fr_2fr] md:items-center">
            <div>
              <h2 id="trial-heading" className="text-2xl font-bold text-ink-900">{trial > 0 ? `${toBnDigits(trial)} দিনের ফ্রি ট্রায়াল` : "ফ্রি প্ল্যান দিয়ে শুরু করুন"}</h2>
              <p className="mt-2 text-sm text-slate-600">কোনো কার্ড বা অগ্রিম পেমেন্ট লাগবে না। ট্রায়াল শেষে আপনার সব হিসাব সংরক্ষিত থাকবে।</p>
              {!user && <Link prefetch={false} href="/register" className="btn-primary mt-4 inline-flex">ফ্রি ট্রায়াল শুরু করুন</Link>}
            </div>
            <ol className="grid gap-3 sm:grid-cols-3">
              {[
                ["১", "রেজিস্টার করুন", "ব্যবসার নাম, মোবাইল ও পাসওয়ার্ড দিন — হিসাবের খাত, রোল ও সেটিং নিজে থেকেই তৈরি হবে।"],
                ["২", "ফ্রি ব্যবহার করুন", "ট্রায়ালে প্ল্যানের সব ফিচার চালু — বিক্রয়, ক্রয়, স্টক, হিসাব, রিপোর্ট।"],
                ["৩", "প্ল্যান নিন", "পছন্দ হলে প্ল্যান নির্বাচন করে বিকাশ/নগদ বা অন্য মাধ্যমে পেমেন্ট করুন — সাথে সাথে চালু।"],
              ].map(([n, t, d]) => (
                <li key={n} className="rounded-lg bg-brand-50 p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 font-bold text-white" aria-hidden>{n}</span>
                  <h3 className="mt-2 font-semibold text-ink-900">{t}</h3>
                  <p className="mt-1 text-xs text-slate-600">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* pricing + comparison (from the database) */}
        <div className="mx-auto max-w-6xl px-4 py-16">
          <PricingSection heading="h2" plans={plans} features={features} cycle={cycle} trialDays={trial} currency={settings.currency === "BDT" ? "৳" : settings.currency} loggedIn={!!user} basePath="/" />
        </div>

        {/* why */}
        <section className="bg-white py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-center text-2xl font-bold text-ink-900">কেন বিজয় লেনদেন?</h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {WHY.map((w) => (
                <li key={w.title}>
                  <h3 className="font-semibold text-ink-900"><span aria-hidden className="text-brand-600">✔ </span>{w.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{w.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* faq */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16">
          <h2 className="text-center text-2xl font-bold text-ink-900">সাধারণ প্রশ্ন</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="panel group p-4">
                <summary className="cursor-pointer list-none font-medium text-ink-900 marker:hidden">
                  <span className="mr-2 inline-block text-brand-600 transition-transform group-open:rotate-90" aria-hidden>›</span>{f.q}
                </summary>
                <p className="mt-2 pl-5 text-sm text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* owner profile */}
        <ProfileSection />

        {/* contact + final CTA */}
        <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-20 bg-brand-700 text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-12 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="contact-heading" className="text-2xl font-bold">যোগাযোগ</h2>
              <p className="mt-1 text-brand-50">প্রশ্ন আছে বা ডেমো দেখতে চান? সরাসরি যোগাযোগ করুন:</p>
              <address className="mt-4 space-y-2 not-italic">
                <p className="text-lg font-semibold">
                  {CONTACT.person} <span className="text-sm font-normal text-brand-100">({CONTACT.role})</span>
                </p>
                <p className="flex items-start gap-2"><span aria-hidden>📍</span><span><span className="sr-only">ঠিকানা: </span>{CONTACT.address}</span></p>
                <p className="flex items-center gap-2">
                  <span aria-hidden>📞</span>
                  <a href={CONTACT.phoneHref} className="text-lg font-bold underline decoration-2 underline-offset-4 hover:text-brand-50" aria-label={`কল করুন: ${CONTACT.phoneDisplay}`}>{CONTACT.phoneDisplay}</a>
                </p>
                {email && <p className="flex items-center gap-2"><span aria-hidden>✉</span><a href={`mailto:${email}`} className="underline">{email}</a></p>}
              </address>
            </div>
            <Link prefetch={false} href={user ? "/dashboard" : "/register"} className="rounded-md bg-white px-5 py-2.5 font-semibold text-brand-800 hover:bg-brand-50">
              {user ? "ড্যাশবোর্ডে যান →" : "ফ্রি ট্রায়াল শুরু করুন"}
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
