import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { runTick } from "@/lib/escrow-tick";
import { betsV1Gone } from "@/lib/bets-v1-gate";

export async function POST(req: Request) {
  const gone = betsV1Gone();
  if (gone) return gone;
  const body = await req.text();
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (current && next) {
    // Producción: exigir firma válida de QStash.
    const signature = req.headers.get("upstash-signature");
    if (!signature) {
      return NextResponse.json({ error: "Sin firma" }, { status: 401 });
    }
    try {
      const ok = await new Receiver({
        currentSigningKey: current,
        nextSigningKey: next,
      }).verify({ signature, body });
      if (!ok) throw new Error("invalid");
    } catch {
      return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // En prod sin claves configuradas, no exponer el tick.
    return NextResponse.json({ error: "Tick no configurado" }, { status: 401 });
  }
  // En dev sin claves: permitido (para poder dispararlo a mano).

  const result = await runTick();
  return NextResponse.json({ ok: true, ...result });
}
