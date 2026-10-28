import type { Metadata } from "next";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/components/lang";
import { Toaster } from "@/components/toaster";
import { NavWatchdog } from "@/components/nav-watchdog";
import { DigitInputs } from "@/components/digit-inputs";
import { EnglishScreen } from "@/components/digit-display";
import { getLang } from "@/server/i18n";

// Typography: Bengali text in Noto Sans Bengali, English text and digits in Inter. Both are
// self-hosted by next/font at build time (no request to Google at runtime, CSP font-src 'self')
// with size-matched fallbacks while loading. The stack and the type scale live in globals.css.
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", display: "swap" });
const latin = Inter({ subsets: ["latin"], variable: "--font-latin", display: "swap" });

export const metadata: Metadata = {
  title: { default: "বিজয় লেনদেন", template: "%s | বিজয় লেনদেন" },
  description: "বিজয় লেনদেন — ব্যবসায়িক হিসাব ও লেনদেন ব্যবস্থাপনা",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${latin.variable} ${bengali.variable}`} data-lang-pending={lang === "en" ? "" : undefined}>
      <body className="min-h-screen font-sans">
        <LangProvider lang={lang}>
          <Toaster>{children}</Toaster>
          <NavWatchdog />
          {/* number fields: Bangla / mixed digits → English as typed; English UI: remaining Bangla text and digits → English */}
          <DigitInputs />
          <EnglishScreen on={lang === "en"} />
        </LangProvider>
      </body>
    </html>
  );
}
