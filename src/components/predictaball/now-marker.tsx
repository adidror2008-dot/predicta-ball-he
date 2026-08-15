export function NowMarker() {
  return (
    <div className="my-3 flex items-center gap-2" role="separator">
      <span className="rounded-full bg-brand-gradient px-2.5 py-0.5 text-[11px] font-bold text-brand-foreground">
        עכשיו
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
