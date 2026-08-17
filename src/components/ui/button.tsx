import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-bold transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bmw-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bmw-black active:scale-[0.985]",
  {
    variants: {
      variant: {
        primary: "bg-bmw-blue text-white hover:bg-bmw-electricBlue hover:shadow-bmw-glow",
        danger: "bg-bmw-mRed text-white hover:brightness-110 hover:shadow-m-red-glow",
        success: "bg-emerald-600 text-white hover:bg-emerald-500",
        outline:
          "border border-bmw-cardBorder bg-bmw-carbon text-bmw-silver hover:border-bmw-blue hover:text-white",
        ghost: "text-bmw-muted hover:bg-bmw-card hover:text-white",
        subtle: "bg-bmw-card text-bmw-silver hover:bg-bmw-cardBorder",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { buttonVariants };
