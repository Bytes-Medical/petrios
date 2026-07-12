# Petrios — production image (see docs/self-hosting.md)
#
# Build:  docker build -t byte-teaching .
# Run:    docker run --env-file .env.local -p 3000:3000 byte-teaching
#
# The app talks to Supabase (hosted or self-hosted) over the network; this
# image contains only the Next.js standalone server.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time env placeholders: nothing in the build talks to external
# services (all env access in lib/ is lazy, inside request-time functions).
ENV NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder \
    SUPABASE_SERVICE_ROLE_KEY=build-placeholder \
    NEXT_PUBLIC_APP_URL=https://build-placeholder.invalid
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

# Standalone server + static assets. public/ is required at runtime for the
# PDF fonts (lib/portfolio, lib/certificates) and static assets.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
