import { formatOemNumber } from "@/lib/utils";

export function OemCode({ value, className = "" }: { value?: string | null; className?: string }) {
  return <span dir="ltr" className={`inline-block whitespace-nowrap text-left font-mono text-xs font-bold tracking-normal select-all ${className}`}>{formatOemNumber(value)}</span>;
}
