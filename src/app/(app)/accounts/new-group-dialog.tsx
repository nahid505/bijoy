"use client";

// "+ নতুন গ্রুপ" popup of the account form: creates an account group without leaving the page.
import type { GroupOption } from "./account-form";
import { AccountGroupDialog } from "./group-dialog";

export function NewGroupDialog({
  groups,
  onCancel,
  onCreated,
}: {
  groups: GroupOption[];
  onCancel: () => void;
  onCreated: (g: GroupOption) => void;
}) {
  return <AccountGroupDialog groups={groups} onCancel={onCancel} onSaved={onCreated} />;
}
