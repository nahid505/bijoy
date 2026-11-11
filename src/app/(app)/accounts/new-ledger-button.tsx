"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/components/lang";
import { useToast } from "@/components/toaster";
import type { GroupOption } from "./account-form";
import { AccountGroupDialog } from "./group-dialog";
import { NewLedgerDialog } from "./new-ledger-dialog";

export function NewLedgerButton({
  groups,
  allGroups,
}: {
  groups: GroupOption[];
  allGroups: GroupOption[];
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [openLedger, setOpenLedger] = useState(false);
  const [openGroup, setOpenGroup] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          prefetch={false}
          href="/settings/account-groups"
          className="btn-secondary text-xs sm:text-sm"
        >
          {t("গ্রুপ ম্যানেজমেন্ট")}
        </Link>
        <button
          type="button"
          onClick={() => setOpenGroup(true)}
          className="btn-secondary flex items-center gap-1 text-xs sm:text-sm"
        >
          <span>+</span>
          <span>{t("নতুন গ্রুপ")}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpenLedger(true)}
          className="btn-primary flex items-center gap-1.5 shadow-sm"
        >
          <span>+</span>
          <span>{t("নতুন লেজার")}</span>
        </button>
      </div>

      {openLedger && (
        <NewLedgerDialog
          groups={groups}
          onClose={() => setOpenLedger(false)}
        />
      )}

      {openGroup && (
        <AccountGroupDialog
          groups={allGroups}
          onCancel={() => setOpenGroup(false)}
          onSaved={() => {
            setOpenGroup(false);
            toast(t("নতুন অ্যাকাউন্ট গ্রুপ তৈরি হয়েছে"), "success");
            router.refresh();
          }}
        />
      )}
    </>
  );
}
