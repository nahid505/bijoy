"use client";

import { useEffect, useState, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Register Service Worker if supported
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // silent fallback
      });
    }

    // Check if running in standalone mode
    const standaloneMedia = window.matchMedia("(display-mode: standalone)");
    const checkStandalone = () => {
      setIsStandalone(standaloneMedia.matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    };
    checkStandalone();
    standaloneMedia.addEventListener("change", checkStandalone);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      standaloneMedia.removeEventListener("change", checkStandalone);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  }, [deferredPrompt]);

  return {
    canInstallPrompt: !!deferredPrompt,
    isStandalone,
    isInstalled,
    triggerInstall,
  };
}

export function DownloadModal({
  isOpen,
  onClose,
  initialTab = "android",
}: {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "android" | "windows";
}) {
  const [tab, setTab] = useState<"android" | "windows">(initialTab);
  const { canInstallPrompt, isStandalone, isInstalled, triggerInstall } = usePWAInstall();

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleInstallClick = async () => {
    await triggerInstall();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm transition-opacity" onClick={onClose} aria-hidden="true" />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/10 text-slate-800"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">৳</span>
              <h2 className="text-lg font-bold text-ink-900">বিজয় লেনদেন অ্যাপ ডাউনলোড ও ইনস্টলেশন</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">সহজেই মোবাইল ও কম্পিউটারে অ্যাপ হিসেবে ব্যবহার করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
            aria-label="বন্ধ করুন"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="mt-4 flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setTab("android")}
            className={`flex-1 rounded-md py-2 text-xs font-semibold transition cursor-pointer ${
              tab === "android" ? "bg-white text-ink-900 shadow-xs" : "text-slate-600 hover:text-ink-900"
            }`}
          >
            📱 Android (মোবাইল)
          </button>
          <button
            type="button"
            onClick={() => setTab("windows")}
            className={`flex-1 rounded-md py-2 text-xs font-semibold transition cursor-pointer ${
              tab === "windows" ? "bg-white text-ink-900 shadow-xs" : "text-slate-600 hover:text-ink-900"
            }`}
          >
            💻 Windows (পিসি / কম্পিউটার)
          </button>
        </div>

        {/* Status notice if running in standalone */}
        {(isStandalone || isInstalled) && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 border border-emerald-200">
            <span>✅</span>
            <span>অ্যাপটি বর্তমানে ইনস্টল অবস্থায় চলছে</span>
          </div>
        )}

        {/* Content Body */}
        <div className="mt-4 space-y-4">
          {tab === "android" ? (
            <>
              {/* Option 1: Direct APK */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📥</span>
                      <h3 className="text-sm font-bold text-ink-900">সরাসরি APK ডাউনলোড</h3>
                      <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-800">
                        Android APK
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      যেকোনো অ্যান্ড্রয়েড ফোনে সরাসরি APK ফাইল ডাউনলোড করে ইনস্টল করুন।
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <a
                    href="/downloads/bijoy-lenden.apk"
                    download="bijoy-lenden.apk"
                    className="btn-primary inline-flex items-center gap-2 text-xs font-semibold py-2 px-4 shadow-sm"
                  >
                    <span>⬇️</span>
                    <span>APK ফাইল ডাউনলোড করুন</span>
                  </a>
                </div>
              </div>

              {/* Option 2: Browser PWA */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📲</span>
                      <h3 className="text-sm font-bold text-ink-900">ব্রাউজার থেকে ইনস্টল (PWA)</h3>
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                        সুপার ফাস্ট
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      মেমোরি বা স্টোরেজ খরচ ছাড়াই ব্রাউজারের মাধ্যমে সরাসরি হোমস্ক্রিনে অ্যাপ যুক্ত করুন।
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  {canInstallPrompt ? (
                    <button
                      type="button"
                      onClick={handleInstallClick}
                      className="btn-secondary inline-flex items-center gap-2 text-xs font-semibold py-2 px-4 border-brand-600 text-brand-700 hover:bg-brand-50 cursor-pointer"
                    >
                      <span>📲</span>
                      <span>সরাসরি ব্রাউজার থেকে ইনস্টল করুন</span>
                    </button>
                  ) : (
                    <div className="rounded-lg bg-white p-3 text-xs text-slate-600 border border-slate-200 space-y-1">
                      <p className="font-semibold text-slate-800">সহজ ইনস্টল নিয়ম:</p>
                      <p>১. Chrome ব্রাউজারের ওপরের ডানপাশের ৩-ডট (⋮) মেনুতে চাপুন।</p>
                      <p>২. &quot;Add to Home screen&quot; অথবা &quot;Install app&quot; নির্বাচন করুন।</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Windows Option 1: Desktop PWA */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">💻</span>
                      <h3 className="text-sm font-bold text-ink-900">Windows Desktop App (PWA)</h3>
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                        Windows PC
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      কম্পিউটারে কোনো অতিরিক্ত সফটওয়্যার ছাড়াই স্ট্যান্ডঅ্যালোন অ্যাপের মতো ব্যবহার করুন।
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {canInstallPrompt ? (
                    <button
                      type="button"
                      onClick={handleInstallClick}
                      className="btn-primary inline-flex items-center gap-2 text-xs font-semibold py-2 px-4 shadow-sm cursor-pointer"
                    >
                      <span>🖥️</span>
                      <span>কম্পিউটারে সরাসরি ইনস্টল করুন</span>
                    </button>
                  ) : (
                    <div className="rounded-lg bg-white p-3 text-xs text-slate-600 border border-slate-200 space-y-1">
                      <p className="font-semibold text-slate-800">Chrome বা Edge থেকে ইনস্টল নিয়ম:</p>
                      <p>১. অ্যাড্রেস বারের ডানপাশে থাকা ইনস্টল (🖥️ বা ➕) আইকনে চাপুন।</p>
                      <p>২. অথবা ব্রাউজার মেনু থেকে &quot;Apps &gt; Install বিজয় লেনদেন&quot; চাপুন।</p>
                      <p>৩. আপনার কম্পিউটার ডেস্কটপ ও টাস্কবারে স্বয়ংক্রিয়ভাবে শর্টকাট যুক্ত হবে।</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Windows Option 2: Desktop Shortcut */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🔗</span>
                      <h3 className="text-sm font-bold text-ink-900">ডেস্কটপ শর্টকাট ডাউনলোড</h3>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                        Desktop Shortcut
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      ডেস্কটপ আইকন থেকে সরাসরি এক ক্লিকে বিজয় লেনদেন চালু করার শর্টকাট ফাইল।
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <a
                    href="/downloads/Bijoy-Lenden.url"
                    download="Bijoy-Lenden.url"
                    className="btn-secondary inline-flex items-center gap-2 text-xs font-semibold py-2 px-4 border-slate-300 text-slate-700 hover:bg-slate-100"
                  >
                    <span>⬇️</span>
                    <span>ডেস্কটপ শর্টকাট ডাউনলোড</span>
                  </a>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
          >
            বন্ধ করুন
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppDownloadHero() {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"android" | "windows">("android");

  const openModal = (tab: "android" | "windows") => {
    setActiveTab(tab);
    setModalOpen(true);
  };

  return (
    <>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-200">
            মোবাইল ও কম্পিউটারে ব্যবহার করুন
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Mobile App Button */}
          <button
            type="button"
            onClick={() => openModal("android")}
            className="group flex items-center justify-between rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-left transition-all duration-200 hover:border-emerald-400/50 hover:bg-white/[0.12] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-2xl border border-emerald-500/30">
                📱
              </span>
              <div>
                <div className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">
                  📱 মোবাইল অ্যাপ ডাউনলোড
                </div>
                <div className="text-xs text-ink-200">Android APK ও PWA</div>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30">
              Android APK
            </span>
          </button>

          {/* PC / Computer App Button */}
          <button
            type="button"
            onClick={() => openModal("windows")}
            className="group flex items-center justify-between rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-left transition-all duration-200 hover:border-sky-400/50 hover:bg-white/[0.12] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-2xl border border-sky-500/30">
                💻
              </span>
              <div>
                <div className="text-sm font-semibold text-white group-hover:text-sky-300 transition-colors">
                  💻 পিসি / কম্পিউটার অ্যাপ
                </div>
                <div className="text-xs text-ink-200">Windows Desktop App</div>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-medium text-sky-300 border border-sky-500/30">
              Windows PC
            </span>
          </button>
        </div>
      </div>

      <DownloadModal isOpen={modalOpen} onClose={() => setModalOpen(false)} initialTab={activeTab} />
    </>
  );
}

export function AppDownloadLogin() {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"android" | "windows">("android");

  const openModal = (tab: "android" | "windows") => {
    setActiveTab(tab);
    setModalOpen(true);
  };

  return (
    <>
      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="relative mb-3 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-slate-200" />
          </div>
          <span className="relative bg-paper px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            অ্যাপ ডাউনলোড করুন
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => openModal("android")}
            className="group flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-500 hover:bg-brand-50/40 shadow-xs focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-xl">📱</span>
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                APK
              </span>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800 group-hover:text-brand-700 transition-colors">
                Android App
              </div>
              <div className="text-[11px] text-slate-500">মোবাইল সংস্করণ</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => openModal("windows")}
            className="group flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-500 hover:bg-brand-50/40 shadow-xs focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-xl">💻</span>
              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 border border-sky-200">
                PC PWA
              </span>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800 group-hover:text-brand-700 transition-colors">
                Windows App
              </div>
              <div className="text-[11px] text-slate-500">কম্পিউটার সংস্করণ</div>
            </div>
          </button>
        </div>
      </div>

      <DownloadModal isOpen={modalOpen} onClose={() => setModalOpen(false)} initialTab={activeTab} />
    </>
  );
}
