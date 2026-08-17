import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("bmw-card", className)} {...props} />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center justify-between gap-3 border-b border-bmw-cardBorder px-5 py-4", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("flex items-center gap-2 text-base font-bold text-white", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-5", className)} {...props} />,
);
CardContent.displayName = "CardContent";

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  hint?: React.ReactNode;
  accent?: "blue" | "green" | "yellow" | "red" | "purple";
  icon?: React.ReactNode;
}

const ACCENT_BAR: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  blue: "bg-bmw-blue",
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-bmw-mRed",
  purple: "bg-purple-500",
};

const ACCENT_TEXT: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  blue: "text-white",
  green: "text-emerald-400",
  yellow: "text-amber-400",
  red: "text-bmw-mRed",
  purple: "text-purple-400",
};

export function KpiCard({ label, value, unit, hint, accent = "blue", icon }: KpiCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-bmw-cardBorder bg-bmw-card p-5">
      <div className={cn("absolute right-0 top-0 h-full w-1", ACCENT_BAR[accent])} />
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-bmw-muted">{label}</p>
        {icon ? <span className="text-bmw-muted">{icon}</span> : null}
      </div>
      <h3 className={cn("tabular text-2xl font-bold tracking-tight", ACCENT_TEXT[accent])}>
        {value}
        {unit ? <span className="mr-1 text-sm font-normal text-bmw-muted">{unit}</span> : null}
      </h3>
      {hint ? <div className="mt-2 text-[11px] text-bmw-muted">{hint}</div> : null}
    </div>
  );
}
