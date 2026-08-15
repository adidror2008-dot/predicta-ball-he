import { Link } from "@tanstack/react-router";
import { CalendarDays, Newspaper, Settings } from "lucide-react";

const tabs = [
  { to: "/", label: "משחקים", icon: CalendarDays },
  { to: "/news", label: "חדשות", icon: Newspaper },
  { to: "/settings", label: "הגדרות", icon: Settings },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 start-0 end-0 z-40 border-t border-border bg-surface-2/95 backdrop-blur">
      <ul className="mx-auto flex w-full max-w-lg items-stretch">
        {tabs.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex flex-col items-center gap-1 py-2.5 text-muted-foreground transition-colors"
              activeProps={{ className: "text-brand" }}
            >
              <Icon className="size-5" aria-hidden />
              <span className="text-[11px] font-medium">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
