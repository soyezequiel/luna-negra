# Probar Bunker Auto Login (BAL)

BAL está habilitado para el juego con slug `ajedrez`. Ambos consumidores usan el
SDK local `F:\proyectos\SDK NGP`.

## Preparación local

1. En `SDK NGP`: `npm install`, `npm test` y `npm run build`.
2. En `ajedrez/web`: `npm install` y `npm run dev` (por defecto
   `http://localhost:5173`). Arrancar también el server para completar el login.
3. En Luna Negra: configurar `ajedrez.gameUrl` con ese origen, ejecutar
   `npm install` y `npm run dev`, y seleccionarlo desde **Jugar**. El consentimiento
   BAL debe aparecer en Luna **antes** de que se abra el juego. Una URL del juego
   abierta directamente no está registrada y debe caer al login normal.
4. En la consola del juego, comprobar `window.crossOriginIsolated`. Ajedrez usa
   `COOP: restrict-properties` + `COEP: require-corp` para conservar tanto
   `SharedArrayBuffer` como `postMessage`/`closed` con su opener.

## Cuenta por email

1. Cerrar sesión en Luna Negra y entrar por enlace mágico de email.
2. Seleccionar Ajedrez desde Luna Negra.
3. Verificar que el pre-permiso muestra juego, origen exacto, pubkey activa y permisos.
4. Elegir **Dar permiso y jugar**. Ajedrez debe abrirse recién entonces, obtener
   esa pubkey y seguir su
   challenge Nostr sin mostrar ni copiar una Bunker URI.
5. Recargar Ajedrez: el permiso de ese inicio debe conservarse dentro de la pestaña
   actual de Luna y renegociar BAL sin mostrar otro consentimiento. La sesión del
   servidor debe restaurarse inmediatamente con el token mientras el firmante BAL
   se reconecta en segundo plano. Cerrar la ventana del juego y abrirla otra vez
   debe preguntar nuevamente.
6. Repetir marcando **Recordar para próximos inicios** antes de permitir: también
   debe iniciar automáticamente después de cerrar y volver a abrir Ajedrez.
7. Entrar a una sala y elegir **Salir de la sala**: debe volver al inicio de
   Ajedrez sin recargar ni pedir una nueva autorización BAL.
8. Revocar el permiso y repetir con **Jugar sin permiso**: Ajedrez debe abrirse y
   usar su login normal o invitado sin mostrar un segundo consentimiento en Luna.

## Varias pestañas del mismo juego

1. Abrir Ajedrez desde Luna Negra, autorizar BAL y dejar esa pestaña abierta.
2. Copiar la URL limpia de Ajedrez y abrirla directamente en otra pestaña, sin
   `lnOrigin`. La segunda pestaña debe detectar el `SharedWorker` activo, comprobar
   la pubkey mediante el signer compartido y entrar sin otro consentimiento.
3. Firmar una operación desde ambas pestañas. Luna debe seguir mostrando una sola
   sesión BAL: el `SharedWorker` conserva el cliente NIP-46 y enruta las operaciones
   de todas las pestañas del mismo origen.
4. Cerrar solamente la pestaña directa. La pestaña original y BAL deben continuar.
5. Volver a abrir una pestaña directa y luego cerrar la pestaña que abrió Luna. La
   pestaña directa debe seguir firmando: el cliente, su clave efímera y la conexión
   a relays viven en el worker, no en la ventana que hizo el handshake.
6. Cerrar finalmente la última pestaña de Ajedrez y abrir el juego directamente.
   Luna debe cerrar inmediatamente su sesión BAL y el juego abierto directamente
   debe usar el login normal/invitado. Un marcador de `localStorage` vencido no
   concede acceso: el estado real siempre lo confirma el `SharedWorker`.
7. Repetir **Jugar sin permiso** mientras existe otra pestaña BAL. `lnBal=off` debe
   prevalecer y esa pestaña no debe adjuntarse al signer compartido.

Si el navegador no implementa `SharedWorker`, se conserva el comportamiento BAL
anterior en la pestaña lanzada y las pestañas directas usan su login normal.

## nsec importada

1. Cerrar sesión y usar **Clave local → Importar nsec** en Luna Negra.
2. Abrir Ajedrez y repetir las verificaciones anteriores.
3. Confirmar que el juego ve la pubkey derivada, nunca la `nsec`. La URL del juego
   no debe contener `bunker://`, `secret` ni `nsec`.

## Complemento Nostr (NIP-07)

1. Cerrar sesión e ingresar con el complemento del navegador.
2. Seleccionar Ajedrez y verificar que el pre-permiso identifica al firmante como
   **Complemento Nostr · NIP-07**.
3. Probar **Dar permiso y jugar**: Luna debe crear BAL delegando cada operación al
   complemento, que conserva sus propios avisos y políticas de autorización.
4. Repetir con **Jugar sin permiso**: Ajedrez debe usar su login normal o invitado
   sin abrir un segundo consentimiento BAL.

Una clave local generada por Luna Negra también es una identidad BAL `nsec`.
Las sesiones locales anteriores al metadato de procedencia se recuperan del mismo
modo, siempre que la pubkey derivada coincida con la cuenta autenticada. Un bunker
externo sigue sin ser una identidad BAL elegible en v1; Ajedrez conserva su login
actual.

## Rechazo, fallback y revocación

- **Jugar sin permiso** abre el juego con `lnBal=off`: no inicia el handshake BAL,
  no registra la ventana como signer y Ajedrez continúa con su login existente.
- **No permitir** durante un pedido ya iniciado también lleva al login existente;
  la decisión queda en estado neutral, sin mostrar un error de conexión en ninguna app.
- Sin sesión en Luna Negra no aparece consentimiento.
- En **Perfil → Inicio automático en juegos**, revocar Ajedrez. Se cierra también
  su sesión activa y el siguiente inicio vuelve a preguntar.
- Cambiar usuario, origen, tipo de firmante o permisos obliga a pedir consentimiento otra vez.
- Cerrar sesión en Luna Negra envía `BAL_LOGOUT`; ningún envío usa `targetOrigin="*"`.

La conectividad real requiere al menos un relay NIP-46 accesible. Los tests del
SDK cubren wire, expiración, canje único y permisos con un relay en memoria; no
sustituyen esta prueba de navegador entre orígenes.
