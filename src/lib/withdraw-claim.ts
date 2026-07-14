import "server-only";
import { signWithdrawToken } from "@/lib/auth";
import { encodeLnurl } from "@/lib/lnurl";

export type WithdrawClaimLinks = {
  token: string;
  claimUrl: string;
  withdrawLnurl: string;
};

/**
 * Crea los dos handles de un retiro: una página de Luna que dibuja el QR y el
 * LNURL-withdraw que consume la wallet. Ambos llevan el mismo token bearer y
 * vencen junto con la ventana del premio.
 */
export async function createWithdrawClaimLinks(
  participantId: string,
  withdrawDeadline: Date,
  baseUrl: string,
): Promise<WithdrawClaimLinks | null> {
  if (withdrawDeadline.getTime() <= Date.now()) return null;
  const token = await signWithdrawToken(
    participantId,
    Math.floor(withdrawDeadline.getTime() / 1000),
  );
  const base = baseUrl.replace(/\/$/, "");
  return {
    token,
    claimUrl: `${base}/retiro/${token}`,
    withdrawLnurl: encodeLnurl(`${base}/api/escrow/lnurlw/${token}`),
  };
}
