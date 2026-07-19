# Petrios — production image (see docs/self-hosting.md)
#
# Build:  docker build -t petrios \
#           --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
#           --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY \
#           --build-arg NEXT_PUBLIC_APP_URL=https://teaching.example.org .
# Run:    docker run --env-file .env.production -p 3000:3000 petrios
#
# IMPORTANT: NEXT_PUBLIC_* values are inlined into the BROWSER bundle at
# build time (and the CSP in next.config.js derives from them), so they must
# be real at `docker build` — runtime env alone cannot change what the
# browser sees. Changing any NEXT_PUBLIC_* value requires an image rebuild.
# Server-only secrets (service role key, email, cron, AI) stay runtime-only.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# Browser-visible configuration — baked into the client bundle and the CSP.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_JITSI_DOMAIN=meet.jit.si
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  || (echo "ERROR: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY build args are required — they are inlined into the browser bundle. See docs/self-hosting.md." && exit 1)
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_JITSI_DOMAIN=$NEXT_PUBLIC_JITSI_DOMAIN \
    SUPABASE_SERVICE_ROLE_KEY=build-placeholder
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
