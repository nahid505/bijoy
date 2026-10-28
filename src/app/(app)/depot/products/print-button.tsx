"use client";

// "🖨 প্রিন্ট" on the depot product list. When the list is cut into pages, it opens the same list with every row
// (?print=1, which prints itself); otherwise it opens the print dialog straight away.
import { useT } from "@/components/lang";

export function DepotProductsPrintButton({ allHref }: { allHref: string | null }) {
  const t = useT();
  return (
    <button
      type="button"
      id="depot-products-print"
      className="btn-secondary"
      onClick={() => (allHref ? window.location.assign(allHref) : window.print())}
    >
      <span aria-hidden>🖨</span> {t("প্রিন্ট")}
    </button>
  );
}
