export const metadata = { title: "Privacidad · Luna Negra" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">Política de Privacidad</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Última actualización: 3 de junio de 2026
      </p>

      <div className="mt-6 space-y-5 text-sm leading-relaxed text-zinc-300">
        <section>
          <h2 className="text-lg font-semibold text-white">Qué guardamos</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>Tu identidad de Nostr (npub / clave pública).</li>
            <li>
              Tu nombre y avatar, cacheados de tu perfil <strong>público</strong>{" "}
              de Nostr (kind:0).
            </li>
            <li>Tus compras y, si sos proveedor, tu Lightning Address y juegos.</li>
            <li>Una cookie de sesión (JWT, httpOnly) para mantenerte logueado.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            Datos sociales en Nostr
          </h2>
          <p>
            Tu lista de amigos, tus mensajes y tu actividad viven en{" "}
            <strong>relays públicos de Nostr</strong>, fuera del control de Luna
            Negra. Esa información es pública por naturaleza del protocolo (los
            mensajes directos usan cifrado NIP-04, que oculta el contenido pero no
            los metadatos).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">Pagos</h2>
          <p>
            Los pagos se procesan vía Lightning. No pedimos ni guardamos datos de
            tarjetas ni información bancaria.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">Terceros</h2>
          <p>
            Usamos proveedores de infraestructura (hosting, base de datos y un
            proveedor de wallet Lightning) para operar el servicio. No vendemos tus
            datos.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">Contacto</h2>
          <p>
            Por consultas sobre tus datos, contactanos por los canales oficiales de
            Luna Negra.
          </p>
        </section>
      </div>
    </div>
  );
}
