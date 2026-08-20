import { cn } from "@/lib/utils";

export function BallIcon({ spin, className }: { spin?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        spin && "animate-spin motion-reduce:animate-none",
        className,
      )}
    >
      <circle cx="12" cy="12" r="10" className="fill-current" />
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
        className="fill-background"
        opacity="0.3"
      />
      <path
        d="M12 6a6 6 0 100 12 6 6 0 000-12zm0 10a4 4 0 110-8 4 4 0 010 8z"
        className="fill-background"
      />
      <path
        d="M12 8v2M12 14v2M8 12h2M14 12h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
