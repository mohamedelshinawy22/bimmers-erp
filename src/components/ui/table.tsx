import * as React from "react";
import { cn } from "@/lib/utils";

type TableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  containerClassName?: string;
};

export function Table({ className, containerClassName, ...props }: TableProps) {
  return (
    <div className={cn("w-full overflow-x-auto", containerClassName)}>
      <table className={cn("w-full border-collapse text-right text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("border-b border-bmw-cardBorder bg-bmw-carbon/60 text-xs text-bmw-muted", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-bmw-cardBorder/70", className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-bmw-carbon/50", className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-3 font-medium", className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  icon,
  colSpan,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  colSpan?: number;
  children?: React.ReactNode;
}) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon ? <div className="text-bmw-cardBorder">{icon}</div> : null}
      <p className="text-sm font-bold text-bmw-silver">{title}</p>
      {description ? <p className="max-w-md text-xs text-bmw-muted">{description}</p> : null}
      {children ? <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
  if (colSpan) {
    return (
      <tr>
        <td colSpan={colSpan}>{content}</td>
      </tr>
    );
  }
  return content;
}
