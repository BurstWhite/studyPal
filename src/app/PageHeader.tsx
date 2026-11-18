import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Shown on pages whose feature has not been built yet. */
export function NotBuiltYet({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** A titled white panel: the unit every page is built from. */
export function Panel({
  title,
  icon,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card px-5 py-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-2">
          {icon}
          {title && (
            <h2 className="text-[15px] font-semibold tracking-tight">
              {title}
            </h2>
          )}
          <div className="flex-1" />
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Short status pill: how long is left, or what state something is in. */
export function Chip({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "jade" | "warn" | "danger";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "num inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "jade" && "bg-secondary text-secondary-foreground",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "danger" && "bg-danger-soft text-destructive",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** What an empty list says, and usually what to do about it. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** A circular track showing `done` out of `total`, with its own caption. */
export function Ring({
  done,
  total,
  label,
  size = 148,
  children,
}: {
  done: number;
  total: number;
  label: string;
  size?: number;
  children?: ReactNode;
}) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const ratio = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} / ${total}`}
      // The track is drawn at a fixed size; letting flex shrink the box would
      // leave the ring spilling over whatever sits beside it.
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - ratio)}
          className={cn("stroke-primary", ratio === 0 && "hidden")}
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}
