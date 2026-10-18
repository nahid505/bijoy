"use client";

import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "./toaster";
import { useT } from "./lang";

export type FormState = { ok: boolean; message?: string; errors?: Record<string, string[]>; data?: Record<string, string> } | null;
export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const FormCtx = createContext<{ state: FormState; pending: boolean }>({ state: null, pending: false });

/**
 * Form bound to a server action. Dispatches manually (instead of `action=`) so
 * React does not reset the user's input when validation fails.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-5",
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const toast = useToast();
  useEffect(() => {
    if (state?.message) toast(state.message, state.ok ? "success" : "error");
  }, [state, toast]);
  return (
    <FormCtx.Provider value={{ state, pending }}>
      <form
        noValidate
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const fd = new FormData(e.currentTarget, submitter); // includes the clicked button (e.g. then=print)
          startTransition(() => formAction(fd));
        }}
      >
        <FormAlert state={state} />
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function useFormCtx() {
  return useContext(FormCtx);
}

export function SubmitButton({
  children,
  className = "btn-primary",
  pendingText = "সংরক্ষণ হচ্ছে…",
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormCtx();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function FormAlert({ state }: { state: FormState }) {
  if (!state?.message) return null;
  return (
    <div
      role="alert"
      className={`rounded-lg px-4 py-3 text-sm ${
        state.ok ? "bg-brand-50 text-brand-800 ring-1 ring-brand-200" : "bg-red-50 text-red-700 ring-1 ring-red-200"
      }`}
    >
      {state.message}
    </div>
  );
}

export function FieldError({ name }: { name: string }) {
  const { state } = useFormCtx();
  const error = state?.errors?.[name]?.[0];
  return error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null;
}

export function Field({
  label,
  name,
  children,
  hint,
  className = "",
}: {
  label: string;
  name: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  const { state } = useFormCtx();
  const hasError = !!state?.errors?.[name];
  return (
    <div className={className}>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      {children}
      {hint && !hasError && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}

/** Accessible confirmation dialog (replaces window.confirm). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-rule p-0 text-left shadow-2xl backdrop:bg-ink-950/50"
    >
      <div className="p-5">
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-rule bg-ink-50 px-5 py-3">
        <button type="button" className="btn-secondary" onClick={onCancel}>{t("বাতিল")}</button>
        <button type="button" className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm} autoFocus>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

/** A button that runs a bound server action (after an optional confirmation dialog) and reports errors as toasts. */
export function ActionButton({
  action,
  label,
  confirmText,
  className = "btn-danger btn-sm",
  pendingText = "অপেক্ষা করুন…",
}: {
  action: FormAction;
  label: string;
  confirmText?: string;
  className?: string;
  pendingText?: string;
}) {
  const toast = useToast();
  // The toast is raised when the action resolves — not from an effect — so it still appears when
  // the action removes this button from the page (e.g. a retried row leaves a "failed" list).
  const withToast = useCallback<FormAction>(
    async (prev, fd) => {
      const r = await action(prev, fd);
      if (r?.message) toast(r.message, r.ok ? "success" : "error");
      return r;
    },
    [action, toast],
  );
  const [state, formAction, pending] = useActionState(withToast, null);
  const [asking, setAsking] = useState(false);
  const t = useT();
  const run = () => startTransition(() => formAction(new FormData()));
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className={className} disabled={pending} onClick={() => (confirmText ? setAsking(true) : run())}>
        {pending ? t(pendingText) : label}
      </button>
      {state && !state.ok && state.message && <span className="max-w-xs text-xs text-red-600">{state.message}</span>}
      {confirmText && asking && (
        <ConfirmDialog
          open={asking}
          title={t("নিশ্চিত করুন")}
          message={confirmText}
          confirmLabel={label}
          danger={className.includes("danger")}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            run();
          }}
        />
      )}
    </span>
  );
}

/** Submit button of an ActionForm that asks for confirmation first (styled dialog). */
export function ConfirmSubmitButton({
  label,
  title = "নিশ্চিত করুন",
  message,
  className = "btn-danger",
}: {
  label: string;
  title?: string;
  message: string;
  className?: string;
}) {
  const { pending } = useFormCtx();
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const t = useT();
  return (
    <>
      <button ref={ref} type="button" className={className} disabled={pending} onClick={() => setAsking(true)}>
        {pending ? t("অপেক্ষা করুন…") : label}
      </button>
      {asking && (
        <ConfirmDialog
          open
          title={t(title)}
          message={message}
          confirmLabel={label}
          danger={className.includes("danger")}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            ref.current?.form?.requestSubmit();
          }}
        />
      )}
    </>
  );
}

export function PrintButton({ label = "প্রিন্ট" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary" onClick={() => window.print()}>
      🖨 {label}
    </button>
  );
}

/** Opens the browser print dialog once the page has rendered (print views reached from a "প্রিন্ট" link). */
export function AutoPrint() {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
