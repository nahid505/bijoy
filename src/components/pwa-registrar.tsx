"use client";

import { useEffect } from "react";
import { setGlobalPrompt, type BeforeInstallPromptEvent } from "./app-download";

export function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // silent fallback if service worker is unavailable or blocked
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setGlobalPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  return null;
}
