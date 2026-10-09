#!/bin/sh
set -eu
: "${JWT_SECRET:?JWT_SECRET required}"
: "${APP_URL:?APP_URL required}"
# Match scripts/self-hosting/keys.mjs byte-for-byte. Secrets never appear in command arguments.
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
key() {
  head=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64)
  body=$(printf '{"role":"%s","iss":"supabase","iat":0,"exp":2147483647}' "$1" | b64)
  # OpenSSL's HMAC CLI takes the key in argv. Keep /proc private inside this single-purpose container.
  sig=$(printf '%s.%s' "$head" "$body" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64)
  printf '%s.%s.%s' "$head" "$body" "$sig"
}
ANON_KEY=$(key anon)
SERVICE_ROLE_KEY=$(key service_role)
AUTH_HOST=${AUTH_HOST:-auth}; REST_HOST=${REST_HOST:-rest}; STORAGE_HOST=${STORAGE_HOST:-storage}; APP_HOST=${APP_HOST:-app}
# Strict inputs prevent template injection; generated secrets are hex and JWT values base64url.
for host in "$AUTH_HOST" "$REST_HOST" "$STORAGE_HOST" "$APP_HOST"; do
  case "$host" in *[!a-zA-Z0-9.-]*|'') echo 'Invalid internal hostname' >&2; exit 1;; esac
done
case "$APP_URL" in *[!a-zA-Z0-9.:/-]*|'') echo 'Invalid public origin' >&2; exit 1;; esac
sed -e "s|@@ANON@@|$ANON_KEY|g" -e "s|@@SERVICE@@|$SERVICE_ROLE_KEY|g" -e "s|@@ORIGIN@@|$APP_URL|g" \
 -e "s|@@AUTH@@|$AUTH_HOST|g" -e "s|@@REST@@|$REST_HOST|g" -e "s|@@STORAGE@@|$STORAGE_HOST|g" -e "s|@@APP@@|$APP_HOST|g" \
 /petrios/gateway.yaml > /tmp/petrios-envoy.yaml
exec envoy -c /tmp/petrios-envoy.yaml --log-level warn
