"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useT } from "./lang";

type ToastType = "success" | "error" | "info";
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

const FLASH = "bl_flash";

function readFlash(): { type: ToastType; message: string } | null {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH}=`));
  if (!raw) return null;
  document.cookie = `${FLASH}=; Max-Age=0; path=/`;
  try {
    return JSON.parse(decodeURIComponent(raw.slice(FLASH.length + 1)));
  } catch {
    return null;
  }
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pathname = usePathname();

  const push = useCallback((message: string, type: ToastType = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "error" ? 7000 : 4000);
  }, []);

  // Flash messages set by server actions before a redirect.
  useEffect(() => {
    const f = readFlash();
    if (f) push(f.message, f.type);
  }, [pathname, push]);

  const tone = { success: "border-brand-600 bg-white", error: "border-red-600 bg-white", info: "border-ink-600 bg-white" };
  const icon = { success: "✔", error: "✕", info: "ℹ" };

  const t_ = useT();

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-3 lg:bottom-6 lg:items-end lg:pr-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-md border-l-4 px-4 py-3 text-sm text-ink-900 shadow-lg ring-1 ring-black/5 ${tone[t.type]}`}>
            <span className={t.type === "error" ? "text-red-700" : t.type === "success" ? "text-brand-700" : "text-ink-600"}>{icon[t.type]}</span>
            <span>{t_(t.message)}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
