// Skeleton de segmento del App Router: aparece durante las navegaciones de la
// home (filtro por categoría, búsqueda, paginación), que son dinámicas
// (force-dynamic). Imita la vista filtrada: encabezado + chips + grilla con
// barrido shimmer (.ln-shimmer, ya definido en globals.css) escalonado por celda.
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-[22px] py-8">
      {/* Encabezado */}
      <div className="mb-8 ln-shimmer h-10 w-56 rounded-ln-md" />

      {/* Fila de chips de categoría */}
      <div className="mb-7 flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="ln-shimmer h-8 w-24 rounded-full"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>

      {/* Grilla del catálogo */}
      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(214px,1fr))]">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i}>
            <div
              className="ln-shimmer aspect-[3/4] rounded-ln-lg"
              style={{ animationDelay: `${i * 45}ms` }}
            />
            <div
              className="ln-shimmer mt-2.5 h-4 w-3/4 rounded"
              style={{ animationDelay: `${i * 45 + 90}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
