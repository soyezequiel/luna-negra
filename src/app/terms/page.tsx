export const metadata = { title: "Términos y Condiciones · Luna Negra" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">Términos y Condiciones</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Última actualización: 3 de junio de 2026
      </p>

      <div className="prose-invert mt-6 space-y-5 text-sm leading-relaxed text-zinc-300">
        <section>
          <h2 className="text-lg font-semibold text-white">1. Qué es Luna Negra</h2>
          <p>
            Luna Negra es un marketplace de juegos web donde los jugadores compran
            y juegan títulos provistos por terceros (proveedores), con pagos en
            Bitcoin a través de la red Lightning. Al usar el servicio aceptás
            estos términos.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">2. Servicio en beta</h2>
          <p>
            Luna Negra se ofrece &laquo;tal cual&raquo; (as-is), sin garantías de
            disponibilidad ni de funcionamiento. Puede haber errores,
            interrupciones o pérdida de datos.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">3. Edad e identidad</h2>
          <p>
            Debés ser mayor de 18 años. Tu identidad es tu clave de Nostr; sos el
            único responsable de su custodia. No podemos recuperar claves perdidas.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">4. Pagos</h2>
          <p>
            Los pagos se hacen en satoshis vía Lightning y son{" "}
            <strong>irreversibles</strong>. Luna Negra recibe el pago de una compra
            y transfiere al proveedor su parte (custodia momentánea para liquidar);
            no es un banco ni una entidad financiera. Salvo que el proveedor indique
            lo contrario, las compras no son reembolsables.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            5. Contenido de terceros
          </h2>
          <p>
            Los juegos son hospedados y operados por sus proveedores, que son los
            responsables de su contenido, funcionamiento y soporte. Luna Negra
            cobra una comisión sobre las ventas.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">6. Conducta</h2>
          <p>
            No está permitido usar el servicio para actividades ilegales, fraude o
            abuso. Podemos suspender cuentas o despublicar juegos que incumplan.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">
            7. Limitación de responsabilidad
          </h2>
          <p>
            En la máxima medida permitida por la ley, Luna Negra no es responsable
            por daños derivados del uso del servicio, de juegos de terceros ni de
            pérdidas de fondos por errores del usuario o de su wallet.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">8. Cambios</h2>
          <p>
            Podemos actualizar estos términos. El uso continuado del servicio
            implica la aceptación de los cambios.
          </p>
        </section>
      </div>
    </div>
  );
}
