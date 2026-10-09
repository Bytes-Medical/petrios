# One image for every installation; all installation settings are runtime variables.
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runtime-deps
WORKDIR /app
# pg is required by the migration CLI independently of Next output tracing.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=runtime-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --chown=app:app scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chown=app:app scripts/self-hosting ./scripts/self-hosting
COPY --chown=app:app supabase/migrations ./supabase/migrations
COPY --chown=app:app LICENSE ./LICENSE
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "scripts/self-hosting/start.mjs"]
