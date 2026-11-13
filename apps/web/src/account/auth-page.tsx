import type { ReactNode } from 'react';

/** An account page (round 31's screens as pages): a narrow column under the header. */
export function AuthPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {lead === undefined ? null : <p className="text-base text-muted-foreground">{lead}</p>}
      {children}
    </div>
  );
}

/** The divider between Google and the email form. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
