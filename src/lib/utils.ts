// Mini helper para componer clases condicionalmente (sin dependencias extra).
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
