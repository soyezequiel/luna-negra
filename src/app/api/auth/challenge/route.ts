import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { signChallenge } from "@/lib/auth";

export async function POST(req: Request) {
  const { pubkey } = await req.json().catch(() => ({}));
  if (typeof pubkey !== "string" || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    return NextResponse.json({ error: "pubkey inválida" }, { status: 400 });
  }
  const nonce = randomBytes(16).toString("hex");
  const token = await signChallenge(pubkey.toLowerCase(), nonce);
  return NextResponse.json({ token, nonce });
}
