import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { decryptNsec } from "@/lib/custodial-keys";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

// Exporta la clave privada (nsec) de una cuenta custodial al propio dueño. Solo
// tiene sentido para cuentas creadas por email (las que tienen `nsecEnc`); una
// cuenta Nostr normal nunca custodia su clave acá.
export async function GET(req: Request) {
  const rl = await checkRateLimit(`nsec-export:${clientIp(req)}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { nsecEnc: true },
  });
  if (!user?.nsecEnc) {
    return NextResponse.json(
      { error: "Esta cuenta no tiene una clave custodiada" },
      { status: 400 },
    );
  }

  return NextResponse.json({ nsec: decryptNsec(user.nsecEnc) });
}
