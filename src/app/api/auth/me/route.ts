import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { isEmailLoginEnabled } from "@/lib/email";

export async function GET() {
  // `emailLogin` se devuelve siempre (incluso sin sesión) para que el modal de
  // login decida si muestra la pestaña de email.
  const emailLogin = isEmailLoginEnabled();

  const session = await getSession();
  if (!session) return NextResponse.json({ user: null, emailLogin });

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      npub: true,
      pubkey: true,
      email: true,
      nsecEnc: true,
      displayName: true,
      avatarUrl: true,
      lud16: true,
      payoutMethod: true,
      showBetaGames: true,
    },
  });
  if (!user) return NextResponse.json({ user: null, emailLogin });
  // `custodial` = cuenta creada por email con clave custodiada. No exponemos el
  // blob cifrado (`nsecEnc`); solo el booleano para que la UI muestre la opción
  // de exportar la nsec.
  const { nsecEnc, ...rest } = user;
  return NextResponse.json({
    emailLogin,
    user: {
      ...rest,
      custodial: Boolean(nsecEnc),
      isAdmin: isAdmin(session.pubkey),
    },
  });
}
