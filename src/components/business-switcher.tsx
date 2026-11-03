"use client";

import { useTransition } from "react";
import { switchBusinessAction } from "@/server/actions/business";

export interface BusinessGroupSummary {
  name: string;
  isParent: boolean;
  intercompanyCode?: string | null;
}

export function BusinessSwitcher({
  current,
  businesses,
  group,
}: {
  current: string;
  businesses: { id: string; name: string }[];
  group?: BusinessGroupSummary | null;
}) {
  const [pending, start] = useTransition();
  if (businesses.length < 2 && !group) return null;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {group && (
        <span
          className="hidden sm:inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
          title={`গ্রুপ: ${group.name}${group.isParent ? " (প্যারেন্ট প্রতিষ্ঠান)" : ""}`}
        >
          <span>🏢</span>
          <span className="max-w-[6.5rem] truncate">{group.name}</span>
          {group.intercompanyCode && (
            <span className="rounded bg-indigo-200/60 px-1 py-0.2 text-[9px] font-bold text-indigo-900">
              {group.intercompanyCode}
            </span>
          )}
        </span>
      )}
      {businesses.length > 1 && (
        <select
          aria-label="ব্যবসা পরিবর্তন"
          className="input h-10 sm:h-9 w-auto max-w-[7.5rem] shrink-0 truncate py-1 px-2 text-xs font-semibold sm:max-w-[14rem]"
          value={current}
          disabled={pending}
          onChange={(e) => {
            const fd = new FormData();
            fd.set("businessId", e.target.value);
            start(async () => {
              // Full reload: every piece of client state from the previous business is discarded.
              if (await switchBusinessAction(fd)) window.location.assign("/dashboard");
            });
          }}
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
