import { profileName, type NostrProfile } from "@/lib/nostr";

export type AuthDevice = "desktop" | "mobile";

/**
 * Evita ofrecer complementos de escritorio en teléfonos, incluso si usan un
 * viewport ancho o el navegador solicita la versión de escritorio.
 */
export function detectAuthDevice({
  userAgent,
  width,
  coarsePointer,
}: {
  userAgent: string;
  width: number;
  coarsePointer: boolean;
}): AuthDevice {
  const mobileUa =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
      userAgent,
    );
  return mobileUa || (coarsePointer && width < 880) ? "mobile" : "desktop";
}

export function profileHasName(profile: NostrProfile | null): boolean {
  return Boolean(profileName(profile)?.trim());
}

export function needsProfileOnboarding({
  source,
  profile,
}: {
  source: "generated" | "imported" | "custodial" | "other";
  profile: NostrProfile | null;
}): boolean {
  if (source === "generated") return true;
  return source !== "other" && !profileHasName(profile);
}
