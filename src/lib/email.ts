// Envío de email transaccional (magic link de login). Usa Resend si está
// configurado (`RESEND_API_KEY` + `EMAIL_FROM`); en dev, si falta la key, loguea
// el link a la consola del server para poder probar el flujo sin proveedor.
//
// El cliente de Resend se importa dinámicamente para no cargarlo (ni romper el
// build/edge) cuando no se usa.

const FROM = process.env.EMAIL_FROM ?? "Luna Negra <onboarding@resend.dev>";

/**
 * ¿Está habilitado el login por email? En dev siempre (el link se loguea a la
 * consola); en producción solo si está toda la config necesaria: la API key de
 * Resend, el remitente verificado y la clave maestra que cifra las nsec. Sin
 * esto, ni la UI muestra la opción ni los endpoints la aceptan.
 */
export function isEmailLoginEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(
    process.env.RESEND_API_KEY?.trim() &&
      process.env.EMAIL_FROM?.trim() &&
      process.env.ORACLE_ENC_KEY?.trim(),
  );
}

export async function sendMagicLink(to: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    // Fallback de desarrollo: sin proveedor, dejamos el link en la consola.
    console.log(`\n[email] Magic link para ${to}:\n${url}\n`);
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: "Tu link de acceso a Luna Negra",
    html: magicLinkHtml(url),
    text: `Iniciá sesión en Luna Negra con este link (válido 15 minutos):\n\n${url}\n\nSi no lo pediste, ignorá este correo.`,
  });
  if (error) {
    throw new Error(`No se pudo enviar el email: ${error.message}`);
  }
}

function magicLinkHtml(url: string): string {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h1 style="font-size:20px;margin:0 0 16px">Iniciá sesión en Luna Negra</h1>
    <p style="font-size:14px;line-height:1.5;color:#444">
      Hacé clic en el botón para entrar a tu cuenta. El enlace es válido por 15 minutos.
    </p>
    <p style="margin:24px 0">
      <a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
        Entrar a Luna Negra
      </a>
    </p>
    <p style="font-size:12px;color:#888;line-height:1.5">
      Si no pediste este acceso, podés ignorar este correo. Si el botón no funciona,
      copiá y pegá esta URL en tu navegador:<br>
      <span style="word-break:break-all">${url}</span>
    </p>
  </div>`;
}
