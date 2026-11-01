"use client";

import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/components/lang";

/**
 * Calculates a safe fallback URL when there is no browser history or when
 * navigating back would exit the application.
 */
function getFallbackUrl(pathname: string): string {
  if (!pathname || pathname === "/dashboard" || pathname === "/") return "/dashboard";
  if (pathname === "/depot/deliveries") return "/dashboard";
  if (pathname.startsWith("/depot/deliveries")) return "/depot/deliveries";
  if (pathname.startsWith("/depot/dealers")) return "/depot/dealers";
  if (pathname.startsWith("/depot/products")) return "/depot/products";
  if (pathname.startsWith("/depot/expenses")) return "/depot/expenses";
  if (pathname.startsWith("/depot/collections")) return "/depot/collections";
  if (pathname.startsWith("/depot/payments")) return "/depot/payments";
  if (pathname.startsWith("/depot/stock-in")) return "/depot/stock-in";
  if (pathname.startsWith("/depot/stock-adjust")) return "/depot/stock-adjust";
  if (pathname.startsWith("/depot/commission")) return "/depot/deliveries";
  if (pathname.startsWith("/depot")) return "/depot/deliveries";
  if (pathname.startsWith("/vouchers")) return "/depot/deliveries";

  // Generic parent segment fallback: e.g. /customers/new -> /customers
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 1) {
    return "/" + segments.slice(0, -1).join("/");
  }
  return "/dashboard";
}

/**
 * Standalone BackButton component that can be used anywhere in the app.
 */
export function BackButton({
  fallbackHref,
  label,
  className = "",
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();

  const handleBack = () => {
    if (typeof window !== "undefined") {
      if (fallbackHref) {
        router.push(fallbackHref);
        return;
      }
      // If external referrer, don't leave the app to an external site
      if (document.referrer && !document.referrer.startsWith(window.location.origin)) {
        router.push(getFallbackUrl(pathname));
        return;
      }
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push(getFallbackUrl(pathname));
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className={`group inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-gray-900 shadow-sm transition-colors cursor-pointer ${className}`}
      aria-label={label ?? t("পেছনে যান")}
      title={label ?? t("পেছনে যান")}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-gray-600 transition-transform group-hover:-translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
      <span>{label ?? t("পেছনে যান")}</span>
    </button>
  );
}

/**
 * Top Back Bar rendered inside the main content container above pages.
 * Hides on dashboard and root home page.
 */
export function TopBackBar() {
  const pathname = usePathname();

  // Do not show back button on dashboard or root page
  if (!pathname || pathname === "/dashboard" || pathname === "/") {
    return null;
  }

  return (
    <div className="no-print mb-2.5 flex items-center">
      <BackButton />
    </div>
  );
}
