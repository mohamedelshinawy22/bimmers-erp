"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const SIZES = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
} as const;

export function Modal({ open, onClose, title, description, size = "md", footer, children }: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  const focusedForOpenRef = React.useRef(false);

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  React.useEffect(() => {
    if (!open) {
      focusedForOpenRef.current = false;
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the dialog only once when it opens. Form modals often
    // receive a fresh onClose callback during controlled-input updates; tying
    // this effect to that callback would steal focus after every keystroke.
    if (!focusedForOpenRef.current) {
      panelRef.current?.focus();
      focusedForOpenRef.current = true;
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        dir="rtl"
        className={cn(
          "relative z-10 my-auto w-full overflow-hidden rounded-2xl border border-bmw-cardBorder bg-bmw-card shadow-2xl animate-scale-in focus:outline-none",
          SIZES[size],
        )}
      >
        <div className="h-1 w-full bmw-m-stripe" />
        <div className="flex items-start justify-between gap-4 border-b border-bmw-cardBorder px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-bmw-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-bmw-carbon hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-bmw-cardBorder bg-bmw-carbon/40 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** Inline alert used for server-action error/success feedback inside forms. */
export function Alert({
  variant = "error",
  children,
  className,
}: {
  variant?: "error" | "success" | "warning" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    error: "border-bmw-mRed/40 bg-bmw-mRed/10 text-red-300",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    info: "border-bmw-blue/40 bg-bmw-blue/10 text-sky-300",
  } as const;
  return (
    <div className={cn("rounded-xl border px-4 py-2.5 text-xs font-medium leading-5", styles[variant], className)}>
      {children}
    </div>
  );
}
