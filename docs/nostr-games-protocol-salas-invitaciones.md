# Salas e invitaciones - Nostr Games Protocol (NGP) (draft)

> ⚠️ **EN CONSTRUCCIÓN — mayormente diseño, no código.** Nostr Games Protocol (NGP) es una mejora
> experimental, **no prometida**, **post-hackathon**. Hoy lo garantizado es la **1.0
> (REST, §1–§8)**. De este documento solo el **reto 1v1 (M0)** está implementado; salas
> NIP-29 y el resto son diseño. Ver [`nostr-games-protocol.md`](nostr-games-protocol.md).

> Extiende la [spec NGP](nostr-games-protocol.md) con las dos piezas multijugador:
> **§4 Salas y estado** y **§5 Invitaciones**, ambas basadas en eventos Nostr. El
> principio rector es **desacoplar**: la *invitación* es una notificación social
> (NGP puro, sin token); la *sala* es donde el juego sincroniza estado y maneja
> el acceso. Cada una vive por su cuenta.
>
> **Alcance honesto.** Esto es para juegos **por turnos con reglas
> determinísticas** (ajedrez, Catan, el penal de futbolcillo). Tiempo real / acción
> y juegos con info oculta **quedan fuera** (ver §X). Es la parte más pesada de
> NGP: no es un win gratis como el marcador.
>
> **Estado.** Borrador. Los `kind` propios pueden cambiar hasta congelar la v1.

---

## 1. El principio: dos capas separadas

En la 1.0, invitación y sala vienen **pegadas**: el invite lleva el token de
acceso a la sala. Eso obliga a que la invitación conozca la tecnología de la sala.
En NGP las cortamos:

| Capa | Qué es | Tecnología | Privada |
|---|---|---|---|
| **Invitación** | "npub A te invita a jugar Z" (señal social) | NIP-17 (DM cifrado) | sí |
| **Sala** | dónde el juego sincroniza estado + quién puede entrar | NIP-29 (grupo en relay) | según el grupo |

La invitación **no otorga acceso**: es solo un puntero ("vení acá"). El control de
acceso vive en la **sala** (la membresía NIP-29). Resultado: la invitación es Nostr
de punta a punta sin importar nada de la sala, y las salas exclusivas resuelven su
propio "quién entra" sin meter tokens en el DM.

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
    ["room", "<groupId>", "wss://relay.tu-juego.com"], // sala opcional + relay
    ["url", "https://tu-juego.com/?room=…"],   // deep link opcional para lanzar
    ["expiration", "1719363600"]               // NIP-40: la invitación caduca
  ],
  "content": "¡Te invito a una partida de Catan! 🎲"
}
```

- **Desacoplada:** no hay token de acceso. Solo el `game` (obligatorio) y, si hay
  sala, su `room` (id del grupo NIP-29) + hint de relay.
- **1v1 / reto:** omití `room`. La invitación *es* todo: "vos + yo + el juego Z".
  Esto es exactamente lo que hace futbolcillo y no necesita §4 para nada.
- **Recepción:** el cliente del invitado (su pestaña de tienda, o el juego) lee sus
  DMs NIP-17 y muestra el toast. Si está offline, **la invitación lo espera en sus
  DMs** (mejor que el toast efímero de la 1.0).
- **Aceptar:** al aceptar, el cliente resuelve cómo entrar a `room` por su cuenta
  (§3). La invitación ya cumplió su rol y no se entera del resto.

> **Solo-por-invitación:** una invitación es una *sugerencia*, no una llave. Para
> que la sala sea exclusiva, el anfitrión **agrega al invitado a la membresía del
> grupo** (§3.2) — idealmente antes o al mandar el DM. El acceso lo decide la sala,
> no el DM.

---

## 3. Sala — NIP-29 (grupo manejado por relay)

Una sala es un **grupo NIP-29**: un grupo que vive en un relay *group-aware*. El
relay hace de **anfitrión**: lleva la membresía, ordena los eventos y modera. Eso
te devuelve las dos cosas más difíciles del multijugador descentralizado —**orden**
y **control de acceso**— sin atarte a Luna Negra (cualquier relay NIP-29 sirve;
podés correr el tuyo en el self-host).

- **Identidad de la sala:** `<relay>'<groupId>` (formato NIP-29). El `groupId` es
  lo que viaja en el tag `room` de la invitación.
- **Pertenencia al grupo:** todo evento de la sala lleva el tag **`h` = `<groupId>`**.
  El relay rechaza los de quien no es miembro → anti-spam y exclusividad gratis.

### 3.1 Estado del juego — *event-sourcing* de jugadas

Para juegos por turnos, **no** uses un "bolso compartido" mutable (como la 1.0):
en Nostr no tiene dueño y genera conflictos. En su lugar, **cada jugada es un
evento** y el estado se reconstruye repitiéndolas en orden (el relay las ordena).

```jsonc
{
  "kind": 9421,                                // (propuesto) jugada de juego
  "pubkey": "<pubkey del jugador que mueve>",  // firmada por su autor
  "tags": [
    ["h", "<groupId>"],                        // sala (NIP-29)
    ["a", "30023:npub1dev…:catan"],            // juego
    ["seq", "7"],                              // número de turno (orden lógico)
    ["prev", "<id de la jugada anterior>"]     // encadena → integridad de orden
  ],
  "content": "{\"action\":\"build\",\"road\":[3,4]}"  // jugada, formato del juego
}
```

- **Firmada por su autor** → no podés falsificar la jugada del rival (mejora real
  sobre el bolso last-write-wins de la 1.0).
- **`seq` + `prev`** encadenan las jugadas: cualquier cliente detecta huecos o
  bifurcaciones. El relay da el orden de llegada; el chain da el orden *lógico*.
- **Estado = fold de las jugadas.** Reconectarte = bajar las jugadas del grupo y
  repetirlas. Persistencia y diferido salen gratis.
- **Snapshot opcional:** para partidas largas, el anfitrión puede publicar un
  evento *addressable* con el estado consolidado cada N turnos (optimización; no
  obligatorio).

### 3.2 Membresía y moderación

Las da NIP-29 tal cual (no inventamos nada): el anfitrión crea el grupo y agrega
miembros con los eventos de moderación del NIP (`kind:9007` crear, `kind:9000`
add-user, etc.). La metadata del grupo (kind `39000`+) dice nombre, si es abierto
o cerrado, y la lista de miembros. **Ahí vive el control de acceso** que la
invitación deliberadamente no lleva.

---

## 4. El circuito completo (cómo encajan §4 y §5)

```
1. Anfitrión crea la sala  ──▶ grupo NIP-29 en su relay (groupId)
2. Anfitrión agrega al invitado a la membresía del grupo (NIP-29 add-user)
3. Anfitrión firma la invitación ──▶ DM NIP-17 con tag room=groupId (SIN token)
4. Invitado recibe el DM (lo esperó si estaba offline) y acepta
5. Invitado entra al grupo y baja las jugadas (h=groupId) ──▶ reconstruye estado
6. Cada uno firma sus jugadas (kind:9421, h=groupId, seq/prev) ──▶ el relay ordena
7. Fin de partida: el resultado puede publicarse como evento (y, si hay apuesta,
   lo verifica el oráculo en 1.0 — ver spec principal §3.4/§7)
```

Las dos capas no se tocan: podrías cambiar NIP-29 por otra cosa sin tocar la
invitación, y viceversa.

---

## 5. Qué queda fuera (límites honestos)

| Caso | Por qué no | Alternativa |
|---|---|---|
| **Tiempo real / acción** | Latencia de relays (100-500ms+ variable) y sin orden fino → se siente lagueado | dejar el estado vivo en 1.0 o P2P (WebRTC); usar Nostr solo para lobby/resultado |
| **Info oculta** (manos de cartas, niebla) | Los eventos del grupo son visibles para los miembros | commit-reveal o cifrado por jugador (subproblema; evitar en v1) |
| **Reglas no determinísticas / lógica secreta** | Sin árbitro, cada cliente valida las reglas; si no son reproducibles, no cierra | mantener un árbitro (game server 1.0) |
| **Azar** (dados, mezclar) | No se le cree a un cliente | commit-reveal entre jugadores, o aleatoriedad verificable (URD, como vesta) |

> **Dependencia de relay:** la sala necesita un relay NIP-29 vivo y compartido.
> Correr el tuyo en el self-host te da control; seguís siendo portable porque es un
> relay NIP-29 estándar, intercambiable.

---

## 6. Mapa con la 1.0

| 1.0 (panel) | NGP | Cambio principal |
|---|---|---|
| **§4 Salas y estado** (bolso compartido hosteado por Luna Negra) | grupo NIP-29 + jugadas event-sourced | el estado pasa de tu servidor a un relay; jugadas firmadas; persistente |
| **§5 Invitaciones** (POST /invites con token, toast efímero) | DM NIP-17 que solo apunta (sin token) | desacoplada; persistente; cross-cliente; el acceso lo maneja la sala |
| §5 Amigos | NIP-02 (ya era Nostr) | sin cambio |

---

## 7. Niveles de adopción (multijugador)

Para no obligar a todo:

- **M0 — Reto 1v1:** solo invitación NIP-17 **sin** `room`. No necesita §4 ni
  relay NIP-29. Es el primer paso recomendado (autocontenido, como futbolcillo).
- **M1 — Sala por turnos:** + grupo NIP-29 + jugadas event-sourced (§3). Necesita
  un relay NIP-29.
- **M2 — Snapshots / partidas largas:** + evento de estado consolidado (§3.1).

> **Recomendación:** arrancar por **M0** (da el 80% del valor social con el 20% del
> trabajo) y subir a M1 solo cuando haya un juego por turnos que lo pida.

---

## Apéndice — kinds usados

| Kind | Qué | Origen | Estado |
|---|---|---|---|
| 14 | Invitación (rumor de DM privado) | NIP-17 | estándar |
| 1059 / 13 | Gift-wrap / seal del DM | NIP-17 | estándar |
| 9007, 9000, 9001, 39000+ | Crear grupo, add/remove miembro, metadata | NIP-29 | estándar |
| 9421 | **Jugada de juego** (en grupo, `h`) | esta spec | *propuesto* |
