# Invitaciones - Nostr Games Protocol (NGP) (draft)

> ⚠️ **Diseño parcialmente implementado.** El **reto/invitación 1v1 por DM
> (NIP-17)** ya se usa (p. ej. en el ajedrez y en futbolcillo). El resto de NGP es
> una mejora experimental **post-hackathon**, no prometida. Ver
> [`nostr-games-protocol.md`](nostr-games-protocol.md).

> Extiende la [spec NGP](nostr-games-protocol.md) con la pieza multijugador social:
> la **invitación a jugar**, basada en un DM Nostr. El principio rector es
> **desacoplar**: la invitación es una notificación social (NGP puro, sin token de
> acceso); *dónde* se juega y *quién puede entrar* lo resuelve el juego por su
> cuenta (su game server, un Room Link, o eventos efímeros — §8 de la spec
> principal). La invitación solo apunta.
>
> **Alcance honesto.** La invitación NIP-17 es liviana y **ya funciona** para retos
> 1v1. La sincronización de estado en vivo (salas) **no** es parte de esta pieza:
> es específica de cada juego (ver §8 de la spec principal, o el game server del
> juego). NGP no fija un esquema de sala estándar.
>
> **Estado.** Borrador. Los `kind` propios pueden cambiar hasta congelar la v1.

---

## 1. El principio: la invitación solo apunta

En la 1.0, invitación y sala venían **pegadas**: el invite llevaba el token de
acceso a la sala. Eso obligaba a que la invitación conociera la tecnología de la
sala. En NGP la invitación es **autónoma**:

| Qué es | Tecnología | Privada |
|---|---|---|
| "npub A te invita a jugar Z" (señal social) | NIP-17 (DM cifrado) | sí |

La invitación **no otorga acceso**: es solo un puntero ("vení acá"). El control de
acceso —si el juego lo necesita— vive donde el juego sincroniza estado (su game
server, su Room Link, etc.), no en el DM. Resultado: la invitación es Nostr de
punta a punta sin importar cómo esté hecha la sala.

---

## 2. Invitación — NIP-17 (DM que solo apunta)

El que invita firma un **mensaje privado** (NIP-17, gift-wrap) al invitado. El
rumor interno es un **kind:14** (mensaje de chat) para que cualquier cliente de DM
lo muestre como texto, con **tags estructurados** que un cliente con soporte de
juego sabe leer:

```jsonc
// Rumor (NIP-17) — se sella y gift-wrappea según NIP-17 antes de publicar.
{
  "kind": 14,                                  // mensaje de chat (lo ve cualquier cliente)
  "pubkey": "<pubkey del que invita>",
  "created_at": 1719360000,
  "tags": [
    ["p", "<pubkey del invitado>"],            // destinatario (NIP-17)
    ["game", "30023:npub1dev…:catan"],         // a QUÉ juego (coordenada)
    ["url", "https://tu-juego.com/?join=…"],   // deep link a la sala del juego (opcional)
    ["expiration", "1719363600"]               // NIP-40: la invitación caduca
  ],
  "content": "¡Te invito a una partida de Catan! 🎲"
}
```

- **Desacoplada:** no hay token de acceso. Solo el `game` (obligatorio) y, si hay
  sala, un `url` de deep link para lanzarla (p. ej. el Room Link `?join` del juego).
- **1v1 / reto:** omití `url`. La invitación *es* todo: "vos + yo + el juego Z".
  Esto es exactamente lo que hace el ajedrez/futbolcillo y no necesita infra de
  salas para nada.
- **Recepción:** el cliente del invitado (su pestaña de tienda, o el juego) lee sus
  DMs NIP-17 y muestra el toast. Si está offline, **la invitación lo espera en sus
  DMs** (mejor que el toast efímero de la 1.0).
- **Aceptar:** al aceptar, el cliente abre el `url` (o, en 1v1, arranca la partida
  directo). La invitación ya cumplió su rol y no se entera del resto.

---

## 3. Dónde se juega (fuera de esta pieza)

La invitación deliberadamente **no** define la sala. El juego elige cómo:

- **1v1 autocontenido:** no hace falta sala; la partida vive entre los dos clientes
  o en el game server del juego (p. ej. el Room Link `?join` del ajedrez, una sala
  hosteada por el propio juego por WebSocket).
- **Estado en vivo:** si el juego necesita sincronizar estado multijugador, lo
  resuelve por su cuenta — game server propio, o eventos **efímeros** (§8 de la
  spec principal, sin esquema estándar). NGP no fija un esquema de sala.

Esto mantiene la invitación **100% portable**: cualquier cliente Nostr la entiende,
sin importar cómo esté hecha la sala.

---

## 4. Niveles de adopción

- **M0 — Reto/invitación 1v1:** solo invitación NIP-17 **sin** `url` de sala.
  Autocontenido. **Ya implementado** (ajedrez, futbolcillo). Es el primer paso
  recomendado.
- **M1 — Invitación con deep link:** + `url` que lanza la sala del juego. La sala la
  hostea el juego (game server / Room Link), no NGP.

> **Recomendación:** arrancar por **M0** (da el 80% del valor social con el 20% del
> trabajo) y sumar el deep link solo cuando haya una sala hosteada que lanzar.

---

## 5. Qué queda fuera (límites honestos)

| Caso | Por qué no es parte de la invitación | Alternativa |
|---|---|---|
| **Sincronización de estado en vivo (salas)** | El esquema es específico de cada juego y la latencia de relays no da para tiempo real fino | game server propio del juego (p. ej. Room Link), o eventos efímeros §8 (sin esquema estándar) |
| **Control de acceso a la sala** | La invitación no lleva token: es una sugerencia, no una llave | lo maneja el juego donde sincroniza estado |
| **Info oculta / azar** | Sin árbitro, no se le cree a un cliente | mantener un árbitro (game server), commit-reveal o aleatoriedad verificable |

---

## Apéndice — kinds usados

| Kind | Qué | Origen | Estado |
|---|---|---|---|
| 14 | Invitación (rumor de DM privado) | NIP-17 | estándar |
| 1059 / 13 | Gift-wrap / seal del DM | NIP-17 | estándar |
