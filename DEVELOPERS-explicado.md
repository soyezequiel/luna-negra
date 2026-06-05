# Luna Negra, explicado en simple

> Esta es la versión **para no-técnicos** de [`DEVELOPERS.md`](DEVELOPERS.md).
> Sirve para entender **qué hace Luna Negra y qué ganás** sin necesidad de saber
> programar. Cuando quieras los detalles para tu equipo técnico, mandalos al
> documento original.

---

## ¿Qué es Luna Negra?

Es una **tienda de videojuegos** (estilo Steam) donde se paga con **Bitcoin por
Lightning** (pagos instantáneos y baratos, en "sats", la unidad chica de Bitcoin).

Lo importante: **tu juego sigue viviendo donde vos quieras** (tu propia web o
servidor). Luna Negra no se queda con tu juego; te aporta cosas que cuestan mucho
construir por tu cuenta:

- **Visibilidad**: tu juego aparece en la tienda y lo descubren jugadores.
- **Cobros**: cobra al jugador y te pasa tu parte, sin que toques nada de pagos.
- **Identidad de los jugadores**: cada jugador entra con su cuenta y vos sabés
  quién es, sin manejar contraseñas.
- **Jugar con amigos, apuestas y avisos automáticos**: funciones extra listas para usar.

---

## La idea en una frase

```
El jugador compra y juega en Luna Negra  →  Luna Negra le avisa a tu juego quién es y qué pagó
```

Vos no tenés que construir el sistema de pagos ni el de login. Luna Negra hace esa
parte y le "pasa el dato" a tu juego.

---

## Las palabras raras, traducidas

| Palabra técnica | En cristiano |
|---|---|
| **npub** | El "nombre de usuario" público del jugador. Es su identidad. |
| **token** | Un pase o entrada digital que prueba algo (que compró, que puede entrar a una sala). Se vence rápido, como un ticket. |
| **API** | La forma en que tu juego y Luna Negra "se hablan" entre sí. |
| **API key** | Una llave secreta que identifica a tu juego ante Luna Negra. No la compartas. |
| **webhook** | Un aviso automático: cuando algo pasa (alguien compró), Luna Negra le toca el timbre a tu juego para avisarle. |
| **Lightning Address** | Tu "alias de cobro" en Bitcoin, parecido a un email (`vos@billetera.com`). Ahí te llega la plata. |
| **escrow** | Un "tercero de confianza" que guarda la plata de una apuesta hasta que se sepa quién ganó, y recién ahí la entrega. |

---

## Lo que tenés que hacer, paso a paso

### 1. Publicar tu juego
Entrás al panel de creadores, completás los datos de tu juego (título, descripción,
**precio en sats**, categoría y la dirección web donde vive tu juego) y das tu
**Lightning Address** (donde querés cobrar). Lo mandás a revisión y, cuando un
administrador lo aprueba, queda publicado en la tienda.

### 2. Cobrar (no hacés nada)
Cuando alguien compra tu juego, Luna Negra le cobra y **te transfiere tu parte
automáticamente** (por defecto el **70%** para vos). No integrás ningún sistema de
pagos.

### 3. Saber quién pagó
Cuando un jugador aprieta **"Jugar"**, Luna Negra abre tu juego y le entrega un
**pase digital** que dice "esta persona pagó y tiene acceso". Tu juego revisa ese
pase y deja entrar. (Esta parte sí la hace tu equipo técnico, pero es sencilla y hay
herramientas listas).

### 4. Jugar con amigos (opcional)
Si tu juego es multijugador, Luna Negra reparte **invitaciones** para que los amigos
se unan a una misma partida o sala.

### 5. Apuestas entre jugadores (opcional)
Dos o más jugadores pueden apostar sats. Luna Negra **guarda la plata** mientras dura
la partida (eso es el *escrow*) y, cuando se sabe quién ganó, **le paga al ganador**
(menos una pequeña comisión). Todo queda registrado de forma que **nadie puede hacer
trampa cambiando las reglas después** de apostar.

### 6. Avisos automáticos (webhooks)
Podés pedirle a Luna Negra que **te avise** cada vez que pasa algo importante:

| Aviso | Significa que… |
|---|---|
| Compra completada | alguien compró tu juego |
| Apuesta resuelta | una apuesta terminó y se pagó |
| Pago enviado | te mandamos tu parte |

### 7. Novedades de tu juego (opcional)
Podés publicar novedades que aparecen en la pestaña de **Actividad** de tu juego,
para mantener a los jugadores al tanto.

---

## Lo más importante que tenés que recordar

- **Tu juego sigue siendo tuyo** y vive donde vos quieras.
- **No manejás pagos ni contraseñas**: Luna Negra se encarga.
- **Cobrás tu parte solo** (por defecto 70%) directo a tu billetera Lightning.
- Las funciones de multijugador y apuestas **son opcionales**: las usás si querés.
- La parte de "conectar tu juego con Luna Negra" la hace tu equipo técnico siguiendo
  el documento [`DEVELOPERS.md`](DEVELOPERS.md), pero ya sabés **qué** hace cada cosa
  y **por qué** conviene.
