import { apiError, apiOk, corsPreflight } from "@/lib/api";
import {
  isNgpContractId,
  syncNgpBetDepositsByContract,
} from "@/lib/ngp-bet-deposit-sync";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contractId = (url.searchParams.get("contractId") ?? url.searchParams.get("id") ?? "")
    .trim()
    .toLowerCase();

  if (!isNgpContractId(contractId)) {
    return apiError("BAD_CONTRACT_ID", "contractId debe ser el id hex del evento 1339", 400);
  }

  try {
    const result = await syncNgpBetDepositsByContract(contractId);
    return apiOk(
      { ok: true, ...result },
      { "Cache-Control": "no-store" },
    );
  } catch (err) {
    console.warn(`[ngp-sync] no se pudo sincronizar ${contractId}:`, err);
    return apiError("SYNC_FAILED", "No se pudo sincronizar la apuesta NGP", 502);
  }
}
