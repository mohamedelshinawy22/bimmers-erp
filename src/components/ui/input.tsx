import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-xl border border-bmw-cardBorder bg-bmw-carbon px-3 py-2 text-sm text-white placeholder:text-bmw-muted/70 transition-colors focus:border-bmw-blue focus:outline-none focus:ring-1 focus:ring-bmw-blue disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(fieldBase, type === "number" && "tabular text-left", className)}
      dir={type === "number" ? "ltr" : undefined}
      {...props}
    />
  ),
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
