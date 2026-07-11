import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Resuelve el providerId desde la sesión del panel /provider. La interfaz REST 1.0
// (autenticación server-to-server por API key) fue retirada: la gestión (declarar
// oráculo BYO, emitir credencial NGE) se hace desde el panel.
export async function providerIdFromSession(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  const p = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
    select: { id: true },
  });
  return p?.id ?? null;
}
