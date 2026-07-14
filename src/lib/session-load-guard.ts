/**
 * Evita que una lectura inicial de sesión, iniciada antes de un login/logout,
 * sobrescriba el estado más nuevo cuando su respuesta llega tarde.
 */
export function createSessionLoadGuard() {
  let revision = 0;

  return {
    snapshot(): number {
      return revision;
    },
    invalidate(): void {
      revision += 1;
    },
    isCurrent(snapshot: number): boolean {
      return snapshot === revision;
    },
  };
}
