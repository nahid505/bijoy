"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/lang";
import type { GroupOption } from "./account-form";
import { NewLedgerDialog } from "./new-ledger-dialog";

export function NewLedgerButton({
  groups,
}: {
  groups: GroupOption[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-primary flex items-center gap-1.5 shadow-sm"
        >
          <span>+</span>
          <span>{t("নতুন লেজার")}</span>
        </button>
      </div>

      {open && (
        <NewLedgerDialog
          groups={groups}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
