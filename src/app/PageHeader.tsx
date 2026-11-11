import type { ReactNode } from "react";

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
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </header>
  );
}

/** Shown on pages whose feature has not been built yet. */
export function NotBuiltYet({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
