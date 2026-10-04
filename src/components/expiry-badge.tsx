import { EXPIRY_ICONS, EXPIRY_LABELS, type ExpiryStatus } from "@/lib/expiry";
import { toBnDigits } from "@/lib/format";
import { Badge } from "./ui";

const TONE = { NONE: "slate", EXPIRED: "red", TODAY: "red", SOON: "amber", VALID: "green" } as const;

/** 🔴 Expired · 🟠 Expiring soon (n days) · 🟢 Valid */
export function ExpiryBadge({ status, showDays = true }: { status: ExpiryStatus; showDays?: boolean }) {
  const days =
    !showDays || status.daysLeft === null
      ? ""
      : status.code === "EXPIRED"
        ? ` · ${toBnDigits(-status.daysLeft)} দিন আগে`
        : status.code === "SOON"
          ? ` · ${toBnDigits(status.daysLeft)} দিন বাকি`
          : "";
  return (
    <Badge tone={TONE[status.code]}>
      <span aria-hidden className="mr-1">{EXPIRY_ICONS[status.code]}</span>
      {EXPIRY_LABELS[status.code]}
      {days}
    </Badge>
  );
}
