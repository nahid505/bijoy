"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useT } from "./lang";

export interface SidebarEntry {
  key: string;
  label: string;
  icon: string;
  href?: string;
  children?: { href: string; label: string }[];
}

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/accounts") return pathname === "/accounts" || /^\/accounts\/(?!cash|bank|debtors|creditors)[^/]+/.test(pathname);
  if (href === "/products") return pathname === "/products" || /^\/products\/(?!categories|brands|units|stock)[^/]+/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavTree({ entries, onNavigate }: { entries: SidebarEntry[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(entries.filter((e) => e.children?.some((c) => isActive(pathname, c.href))).map((e) => [e.key, true])),
  );

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3 text-[13.5px]">
      <ul className="space-y-0.5">
        {entries.map((e) => {
          if (e.href) {
            const active = isActive(pathname, e.href);
            return (
              <li key={e.key}>
                <Link prefetch={false}
                  href={e.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 ${active ? "bg-brand-600 font-semibold text-white" : "text-ink-100 hover:bg-white/8 hover:text-white"}`}
                >
                  <Icon d={e.icon} />
                  {e.label}
                </Link>
              </li>
            );
          }
          const expanded = open[e.key] ?? false;
          const childActive = e.children?.some((c) => isActive(pathname, c.href));
          return (
            <li key={e.key}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [e.key]: !expanded }))}
                aria-expanded={expanded}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left ${childActive ? "text-white" : "text-ink-100"} hover:bg-white/8`}
              >
                <Icon d={e.icon} />
                <span className="flex-1">{e.label}</span>
                <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} fill="currentColor" aria-hidden>
                  <path d="M7 5l6 5-6 5V5z" />
                </svg>
              </button>
              {expanded && (
                <ul className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                  {e.children!.map((c, _i, all) => {
                    // only the most specific match is active (/sms vs /sms/log, /products vs /products/batches)
                    const best = all.filter((x) => isActive(pathname, x.href)).sort((x, y) => y.href.length - x.href.length)[0]?.href;
                    const active = c.href === best;
                    return (
                      <li key={c.href}>
                        <Link prefetch={false}
                          href={c.href}
                          onClick={onNavigate}
                          className={`block rounded px-2.5 py-1.5 ${active ? "bg-white/12 font-semibold text-white" : "text-ink-200 hover:text-white"}`}
                        >
                          {c.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Brand({ businessName }: { businessName: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-600 text-lg font-bold text-white">৳</span>
      <div className="min-w-0 leading-tight">
        <p className="truncate font-bold text-white">বিজয় লেনদেন</p>
        <p className="truncate text-[11px] text-ink-200">{businessName}</p>
      </div>
    </div>
  );
}

export function Sidebar({ entries, businessName }: { entries: SidebarEntry[]; businessName: string }) {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink-900 lg:flex">
      <Brand businessName={businessName} />
      <NavTree entries={entries} />
    </aside>
  );
}

export function MobileNav({
  entries,
  tabs,
  businessName,
}: {
  entries: SidebarEntry[];
  tabs: { href: string; label: string; icon: string }[];
  businessName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <>
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-800 bg-ink-900 text-[11px] lg:hidden">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link prefetch={false} key={t.href} href={t.href} className={`flex flex-col items-center gap-0.5 py-2 ${active ? "text-brand-200" : "text-ink-200"}`}>
              <Icon d={t.icon} className="h-5 w-5" />
              {t.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-ink-200" aria-label={t("মেনু")}>
          <Icon d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
          {t("মেনু")}
        </button>
      </nav>
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink-900">
            <Brand businessName={businessName} />
            <NavTree entries={entries} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
