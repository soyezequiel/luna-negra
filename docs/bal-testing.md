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

## nsec importada

1. Cerrar sesión y usar **Clave local → Importar nsec** en Luna Negra.
2. Abrir Ajedrez y repetir las verificaciones anteriores.
3. Confirmar que el juego ve la pubkey derivada, nunca la `nsec`. La URL del juego
   no debe contener `bunker://`, `secret` ni `nsec`.

Una clave generada por Luna Negra, NIP-07 o un bunker externo no son identidades
BAL elegibles en v1; Ajedrez conserva su login actual.

## Rechazo, fallback y revocación

- **No permitir** lleva al login existente y permite invitado.
- Sin sesión en Luna Negra no aparece consentimiento.
- En **Perfil → Inicio automático en juegos**, revocar Ajedrez. Se cierra también
  su sesión activa y el siguiente inicio vuelve a preguntar.
- Cambiar usuario, origen o permisos obliga a pedir consentimiento otra vez.
- Cerrar sesión en Luna Negra envía `BAL_LOGOUT`; ningún envío usa `targetOrigin="*"`.

La conectividad real requiere al menos un relay NIP-46 accesible. Los tests del
SDK cubren wire, expiración, canje único y permisos con un relay en memoria; no
sustituyen esta prueba de navegador entre orígenes.
