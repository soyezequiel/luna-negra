// Placeholder de carga para una card de catálogo (mientras resuelven los fetches).
export function GameCardSkeleton() {
  return (
    <div className="block">
      <div className="ln-shimmer aspect-[3/4] rounded-ln-lg border border-ln-border" />
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="ln-shimmer h-3.5 w-2/3 rounded-full" />
        <span className="ln-shimmer h-3 w-12 rounded-full" />
      </div>
    </div>
  );
}

export function GameGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(214px,1fr))]">
      {Array.from({ length: count }).map((_, i) => (
        <GameCardSkeleton key={i} />
      ))}
    </div>
  );
}
