import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { verifyApiKey } from "@/lib/api-keys";

// Resuelve el providerId de una request que puede venir de un HUMANO (sesión del
// panel /provider) o de un SERVIDOR (Bearer API key del proveedor). Sirve para
// endpoints de gestión que tienen que ser usables por ambos: p. ej. declarar la
// clave de oráculo propia (BYO) la hace el game server con su API key, pero también
// el dueño desde el panel.
export async function providerIdFromRequest(req: Request): Promise<string | null> {
  const session = await getSession();
  if (session) {
    const p = await prisma.provider.findFirst({
      where: { ownerId: session.sub },
      select: { id: true },
    });
    if (p) return p.id;
  }
  return verifyApiKey(req); // Bearer ln_sk_… → providerId (o null)
}
