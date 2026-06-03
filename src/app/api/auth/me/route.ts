import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      npub: true,
      pubkey: true,
      displayName: true,
      avatarUrl: true,
    },
  });
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user });
}
