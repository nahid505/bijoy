import { EXPIRY_ICONS, EXPIRY_LABELS, type ExpiryStatus } from "@/lib/expiry";
import { toBnDigits } from "@/lib/format";
import { Badge } from "./ui";
import { getT } from "@/server/i18n";

const TONE = { NONE: "slate", EXPIRED: "red", TODAY: "red", SOON: "amber", VALID: "green" } as const;

/** 🔴 Expired · 🟠 Expiring soon (n days) · 🟢 Valid */
export async function ExpiryBadge({ status, showDays = true }: { status: ExpiryStatus; showDays?: boolean }) {
  const t = await getT();
  const days =
    !showDays || status.daysLeft === null
      ? ""
      : status.code === "EXPIRED"
        ? ` · ${t("{n} দিন আগে", { n: toBnDigits(-status.daysLeft) })}`
        : status.code === "SOON"
          ? ` · ${t("{n} দিন বাকি", { n: toBnDigits(status.daysLeft) })}`
          : "";
  return (
    <Badge tone={TONE[status.code]}>
      <span aria-hidden className="mr-1">{EXPIRY_ICONS[status.code]}</span>
      {t(EXPIRY_LABELS[status.code])}
      {days}
    </Badge>
  );
}
