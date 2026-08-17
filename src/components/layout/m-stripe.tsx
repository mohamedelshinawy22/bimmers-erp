import { cn } from "@/lib/utils";

/**
 * BMW M-Performance accent stripe (M Dark Blue → M Light Blue → M Red).
 * Rendered as a real gradient bar rather than three divs so it scales cleanly.
 */
export function MStripe({ className, glow = true }: { className?: string; glow?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "h-1.5 w-full bg-gradient-to-r from-bmw-mDarkBlue via-bmw-blue to-bmw-mRed",
        glow && "shadow-bmw-glow",
        className,
      )}
    />
  );
}

/** Sharp three-band variant used on cards and print headers. */
export function MStripeBands({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bmw-m-stripe h-1 w-full", className)} />;
}
