# syntax=docker/dockerfile:1
#
# Imagen de Luna Negra para self-hosting (fallback: tu compu hace de servidor).
# Multi-stage sobre Debian slim (glibc + OpenSSL 3, que es lo que esperan los
# engines de Prisma con binaryTargets "native"). Se buildea SIN base de datos:
# las migraciones se aplican al arrancar el contenedor (ver docker/entrypoint.sh).

# ── deps: instala dependencias (con cache de capa) ──────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── builder: genera el cliente Prisma y compila Next ────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Valores ficticios SOLO para que el build no falle (next build no se conecta a la
# DB, pero auth.ts exige JWT_SECRET en NODE_ENV=production al importarse). Los
# valores reales se inyectan en runtime vía docker-compose.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    DIRECT_URL="postgresql://build:build@localhost:5432/build" \
    JWT_SECRET="build-only-placeholder-secret"
RUN npx prisma generate
RUN npx next build

# ── runner: imagen final que sirve la app ───────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# node_modules incluye el CLI de Prisma + engines (para migrate deploy en runtime).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma ./prisma
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Defensa contra CRLF si el archivo se editó en Windows.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
