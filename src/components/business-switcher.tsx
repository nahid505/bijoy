"use client";

import { useTransition } from "react";
import { switchBusinessAction } from "@/server/actions/business";

export function BusinessSwitcher({ current, businesses }: { current: string; businesses: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  if (businesses.length < 2) return null;
  return (
    <select
      aria-label="ব্যবসা পরিবর্তন"
      className="input w-auto max-w-[6.5rem] shrink-0 truncate py-1 text-xs sm:max-w-[14rem]"
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
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
}
