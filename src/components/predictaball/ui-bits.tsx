import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LtrNum({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("inline-block", className)}>
      {children}
    </span>
  );
}

export function EmptyState({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card px-6 py-12 text-center shadow-card">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-surface-2", className)} />;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-sm font-bold text-foreground">{children}</h2>;
}

export function LogoSlot({
  className,
  logoUrl,
  name,
}: {
  className?: string;
  logoUrl?: string | null;
  name?: string | null;
}) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

  return (
    <div
      aria-hidden
      className={cn(
        "no-mirror flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2 text-[11px] font-bold text-muted-foreground",
        className,
      )}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" loading="lazy" className="size-full object-contain" />
      ) : (
        initials
      )}
    </div>
  );
}

