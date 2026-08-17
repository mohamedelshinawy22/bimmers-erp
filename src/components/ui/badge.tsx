import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold leading-5 whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-bmw-cardBorder bg-bmw-carbon text-bmw-silver",
        blue: "border-bmw-blue/40 bg-bmw-blue/10 text-bmw-blue",
        oem: "border-bmw-blue/50 bg-bmw-mDarkBlue/40 text-sky-300",
        success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        warning: "border-amber-500/40 bg-amber-500/10 text-amber-400",
        danger: "border-bmw-mRed/40 bg-bmw-mRed/10 text-bmw-mRed",
        muted: "border-bmw-cardBorder bg-bmw-card text-bmw-muted",
        purple: "border-purple-500/40 bg-purple-500/10 text-purple-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  mono?: boolean;
}

export function Badge({ className, variant, mono, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), mono && "font-mono", className)} {...props} />;
}

/** Stock level indicator driven by the reorder threshold. */
export function StockBadge({ quantity, reorderLevel }: { quantity: number; reorderLevel: number }) {
  if (quantity <= 0) {
    return (
      <Badge variant="danger" mono>
        نافد
      </Badge>
    );
  }
  if (quantity <= reorderLevel) {
    return (
      <Badge variant="warning" mono>
        {quantity} حرج
      </Badge>
    );
  }
  return (
    <Badge variant="success" mono>
      {quantity}
    </Badge>
  );
}

export { badgeVariants };
