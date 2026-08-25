import * as React from "react";
import { cn, sanitizeNumericInput } from "@/lib/utils";

const fieldBase =
  "w-full rounded-xl border border-bmw-cardBorder bg-bmw-carbon px-3 py-2 text-sm text-white placeholder:text-bmw-muted/70 transition-colors focus:border-bmw-blue focus:outline-none focus:ring-1 focus:ring-bmw-blue disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", onChange, onInput, min, ...props }, ref) => {
    const numeric = type === "number";
    const allowNegative = numeric && Number(min) < 0;
    const normalize = (element: HTMLInputElement) => {
      if (!numeric) return;
      const next = sanitizeNumericInput(element.value, { allowNegative });
      if (next !== element.value) element.value = next;
    };
    return <input
      ref={ref}
      type={numeric ? "text" : type}
      inputMode={numeric ? "decimal" : props.inputMode}
      min={min}
      data-numeric-input={numeric || undefined}
      className={cn(fieldBase, numeric && "tabular text-left", className)}
      dir={numeric ? "ltr" : undefined}
      onInput={(event) => { normalize(event.currentTarget); onInput?.(event); }}
      onChange={(event) => { normalize(event.currentTarget); onChange?.(event); }}
      {...props}
    />;
  },
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, "cursor-pointer appearance-none pl-8", className)} {...props} />
  ),
);
Select.displayName = "Select";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-[80px] resize-y", className)} {...props} />
));
Textarea.displayName = "Textarea";

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, required, error, hint, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-medium text-bmw-muted">
        {label}
        {required ? <span className="text-bmw-mRed">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] font-medium text-bmw-mRed">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-bmw-muted/80">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("flex cursor-pointer select-none items-center gap-2 text-sm text-bmw-silver", className)}>
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded border-bmw-cardBorder bg-bmw-carbon text-bmw-blue accent-bmw-blue"
        {...props}
      />
      {label}
    </label>
  );
}
