"use client";

import { useEffect, useState, useCallback } from "react";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    __deferredPwaPrompt?: BeforeInstallPromptEvent | null;
  }
}

let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

export function setGlobalPrompt(prompt: BeforeInstallPromptEvent | null) {
  globalDeferredPrompt = prompt;
  if (typeof window !== "undefined") {
    window.__deferredPwaPrompt = prompt;
  }
  promptListeners.forEach((listener) => listener(prompt));
}

// Module-level early capture for browser environments
if (typeof window !== "undefined") {
  if (window.__deferredPwaPrompt) {
    globalDeferredPrompt = window.__deferredPwaPrompt;
  }

  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    setGlobalPrompt(e as BeforeInstallPromptEvent);
  });

  window.addEventListener("appinstalled", () => {
    setGlobalPrompt(null);
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== "undefined") {
      return globalDeferredPrompt || window.__deferredPwaPrompt || null;
    }
    return null;
  });
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

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

    if (globalDeferredPrompt) {
      setDeferredPrompt(globalDeferredPrompt);
    }

    const onPromptChange = (prompt: BeforeInstallPromptEvent | null) => {
      setDeferredPrompt(prompt);
    };
    promptListeners.add(onPromptChange);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setGlobalPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setGlobalPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      standaloneMedia.removeEventListener("change", checkStandalone);
      promptListeners.delete(onPromptChange);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "no-prompt" | "error"> => {
    const prompt = deferredPrompt || globalDeferredPrompt || (typeof window !== "undefined" ? window.__deferredPwaPrompt : null);
    if (!prompt) return "no-prompt";
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
      }
      setGlobalPrompt(null);
      return choice.outcome;
    } catch {
      return "error";
    }
  }, [deferredPrompt]);

  return {
    canInstallPrompt: !!(deferredPrompt || globalDeferredPrompt),
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const { canInstallPrompt, isStandalone, isInstalled, triggerInstall } = usePWAInstall();

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setStatusMessage(null);
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
    if (isStandalone || isInstalled) {
      setStatusMessage("অ্যাপটি ইতিমধ্যে আপনার ডিভাইসে ইনস্টল করা আছে।");
      return;
    }
    const outcome = await triggerInstall();
    if (outcome === "accepted") {
      setStatusMessage("✅ অভিনন্দন! বিজয় লেনদেন অ্যাপ সফলভাবে ইনস্টল করা হয়েছে।");
    } else if (outcome === "dismissed") {
      setStatusMessage("ইনস্টলেশন প্রম্পটটি বন্ধ করা হয়েছে। প্রয়োজন হলে আবার চেষ্টা করতে পারেন।");
    } else if (outcome === "no-prompt") {
      setStatusMessage("ব্রাউজারের অ্যাড্রেস বারের ডানপাশে থাকা ইনস্টল (🖥️ বা ➕) আইকন অথবা মেনু (⋮) থেকে 'Install বিজয় লেনদেন' নির্বাচন করুন।");
    }
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
              <h2 className="text-lg font-bold text-ink-900">বিজয় লেনদেন অ্যাপ ডাউনলোড ও ইনস্টলেশন</h2>
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

        {/* Standalone Status or Direct One-Click Install Banner */}
        {isStandalone || isInstalled ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 border border-emerald-300">
            <span className="text-base">✅</span>
            <span className="font-semibold">অ্যাপটি বর্তমানে আপনার ডিভাইসে ইনস্টল অবস্থায় চালু আছে</span>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/70 p-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">⚡</span>
                  <h3 className="text-sm font-bold text-emerald-950">ওয়ান-ক্লিক অ্যাপ ইনস্টল</h3>
                  <span className="rounded bg-emerald-200/90 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    PWA ইনস্টল
                  </span>
                </div>
                <p className="mt-1 text-xs text-emerald-800">
                  কোনো ফাইল ডাউনলোড ছাড়াই সরাসরি ব্রাউজার থেকে অ্যাপ ইনস্টল করুন।
                </p>
              </div>
              <button
                type="button"
                onClick={handleInstallClick}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 px-4 py-2.5 text-xs font-bold text-white shadow-md transition cursor-pointer shrink-0"
              >
                <span>⬇️</span>
                <span>সরাসরি অ্যাপ ইনস্টল করুন</span>
              </button>
            </div>
            {statusMessage && (
              <div className="mt-2.5 rounded-lg bg-white/95 p-2.5 text-xs font-medium text-emerald-900 border border-emerald-200">
                {statusMessage}
              </div>
            )}
          </div>
        )}

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
                      <span>⬇️</span>
                      <span>সরাসরি অ্যাপ ইনস্টল করুন</span>
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
                      <span>⬇️</span>
                      <span>সরাসরি অ্যাপ ইনস্টল করুন</span>
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
                      ডেস্কটপ আইকন থেকে সরাসরি এক ক্লিকে বিজয় লেনদেন চালু করার শর্টকাট ফাইল।
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

export function AppDownloadHeaderTrigger() {
  const [modalOpen, setModalOpen] = useState(false);
  const { isStandalone } = usePWAInstall();

  // If already running standalone, no need to show install button in header
  if (isStandalone) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex h-10 sm:h-9 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50/70 px-2.5 sm:px-3 text-xs font-semibold text-emerald-800 shadow-2xs transition hover:bg-emerald-100 hover:border-emerald-400 shrink-0 cursor-pointer"
        title="অ্যাপ ইনস্টল বা ডাউনলোড করুন"
        aria-label="অ্যাপ ইনস্টল বা ডাউনলোড করুন"
      >
        <span aria-hidden>📲</span>
        <span className="hidden md:inline">অ্যাপ ইনস্টল</span>
      </button>
      <DownloadModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
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
