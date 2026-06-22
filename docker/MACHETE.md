# 🧉 Machete — manejar el server de Luna Negra

Guía corta para el día a día. **La laptop Ubuntu es el server**; vos la manejás
**por SSH desde la PC de escritorio**. No hace falta tocar la laptop físicamente.

- Server (laptop): `naranja-laptop@192.168.3.25`, proyecto en `~/luna-negra`
- Llave SSH (en la PC): `~/.ssh/luna_laptop`
- Sitio público: `https://luna.naranja.fit`

> ## ⚠️ ¿Desde dónde corro esto?
> **Todos los comandos con `ssh luna` se corren EN LA PC DE ESCRITORIO** (Git Bash o
> PowerShell). El `ssh` se mete solo en la laptop y ejecuta ahí. La llave privada
> vive en la PC, **no** en la laptop.
>
> 👉 Si ya estás **en la terminal de la laptop**, NO uses `ssh` (te conectarías a vos
> misma y no vas a tener la llave). Ahí manejás Docker directo:
> ```bash
> cd ~/luna-negra && docker compose --env-file .env.docker ps
> ```
> Es decir: a los comandos de abajo, sacales el `ssh luna '...'` y corré lo de
> adentro tal cual, ya parada en `~/luna-negra`.

---

## 1. Conectarme a la laptop (terminal interactiva)

```bash
ssh -i ~/.ssh/luna_laptop naranja-laptop@192.168.3.25
```
Quedás "dentro" de la laptop. Para volver: `exit`.
Una vez dentro, andá al proyecto: `cd ~/luna-negra`.

💡 **Atajo opcional**: agregá esto a `~/.ssh/config` (en la PC) y después alcanza con `ssh luna`:
```
Host luna
    HostName 192.168.3.25
    User naranja-laptop
    IdentityFile ~/.ssh/luna_laptop
```

---

## 2. Ver cómo está todo

```bash
# estado de los contenedores
ssh luna 'cd ~/luna-negra && docker compose --env-file .env.docker ps'

# logs de la app en vivo (Ctrl+C corta el seguimiento, NO apaga nada)
ssh luna 'cd ~/luna-negra && docker compose --env-file .env.docker logs -f app'
```
(Si no configuraste el atajo `luna`, reemplazá `ssh luna` por
`ssh -i ~/.ssh/luna_laptop naranja-laptop@192.168.3.25`.)

Tiene que verse `app`, `postgres` (healthy), `cloudflared` y `backup` en estado **Up**.

---

## 3. Actualizar el server tras cambios en el código  ⭐

Esto es lo que más vas a usar. Hay un **script** que hace todo (empaqueta tu código,
lo manda a la laptop y reconstruye). Desde la **PC**, parado en la carpeta del
proyecto (`F:\proyectos\Tienda juegos PC Nostr`):

**PowerShell:**
```powershell
powershell -ExecutionPolicy Bypass -File docker\deploy.ps1
```

**Git Bash:**
```bash
sh docker/deploy.sh
```

> ⚠️ NO uses un `tar ... | ssh ...` (con pipe) en PowerShell: PowerShell corrompe
> los datos binarios del pipe y el build falla con `gzip: not in gzip format`. Por
> eso usamos el script (manda un archivo con `scp`, sin pipe).

Qué hace, en criollo:
1. Empaqueta tu código (sin las carpetas pesadas).
2. Lo manda a la laptop y lo descomprime en `~/luna-negra`.
3. Reconstruye y reinicia solo lo que cambió. Los datos **no se tocan**.

Tarda un rato la primera vez; después es rápido (usa caché).

---

## 4. Arrancar / parar / reiniciar

```bash
# parar todo (los DATOS se conservan)
ssh luna 'cd ~/luna-negra && docker compose --env-file .env.docker down'

# arrancar
ssh luna 'cd ~/luna-negra && docker compose --env-file .env.docker up -d'

# reiniciar solo la app
ssh luna 'cd ~/luna-negra && docker compose --env-file .env.docker restart app'
```

> Tras un corte de luz **no hay que hacer nada**: la laptop bootea y los
> contenedores vuelven solos.

---

## 5. Backups (tus datos)

Se hacen solos cada 6 h en la laptop, en `~/luna-negra/backups/`.

```bash
# ver los backups que hay
ssh luna 'ls -lh ~/luna-negra/backups/'

# traer una copia a la PC (a la carpeta actual)
scp -i ~/.ssh/luna_laptop naranja-laptop@192.168.3.25:'~/luna-negra/backups/*' .
```

⚠️ Esa carpeta es la **única copia** de tus datos. Si el disco de la laptop muere,
se pierde todo. Bajá los backups a la PC / nube cada tanto (o pedí que se
automatice).

Restaurar un backup es delicado (reemplaza datos) → mejor pedí ayuda antes de hacerlo.

---

## 6. Cargar datos de ejemplo (tienda vacía)

Una sola vez: en la laptop editá `~/luna-negra/.env.docker`, poné
`SEED_ON_START=true`, reiniciá con `up -d`, y después volvé a dejarlo en `false`.

---

## 7. Si algo no anda — chequeo rápido

| Síntoma | Qué mirar |
|---|---|
| El sitio no abre | `docker compose ... ps` → ¿están todos **Up**? Si no, `up -d`. |
| Cambié código y no se ve | ¿Corriste el comando de actualizar (sección 3) con `--build`? |
| Dudas de qué pasó | `docker compose ... logs --tail 50 app` (o `cloudflared`). |
| `luna.naranja.fit` no abre | Es config de Cloudflare (Public Hostname → `http://app:3000`), no del server. |

---

📌 Regla de oro: **`down` conserva los datos; `down -v` los BORRA.** No uses `-v`
salvo que quieras empezar de cero.
