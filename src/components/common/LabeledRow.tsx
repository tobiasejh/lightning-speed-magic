import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  hint?: string | undefined;
  /** "xs": text-xs with tabular numbers. "sm": smaller 11px text, plain numbers. */
  size?: "xs" | "sm";
  /** Overrides the vertical spacing (default space-y-1.5). */
  className?: string;
  valueClassName?: string;
  children: ReactNode;
};

/** A label on the left, its current value on the right, and a control below. */
export function LabeledRow({
  label,
  value,
  hint,
  size = "xs",
  className,
  valueClassName,
  children,
}: Props) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "flex items-center justify-between",
          size === "xs" ? "text-xs" : "text-[11px]",
        )}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className={cn(size === "xs" && "tabular-nums", valueClassName) || undefined}>
          {value}
        </span>
      </div>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
