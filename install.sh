#!/bin/sh
# Download the release archive, unpack it, and run this script from that directory.
set -eu
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo 'Install Docker Engine or Docker Desktop first.' >&2; exit 1; }
docker compose version >/dev/null
if [ ! -e .env ]; then
  umask 077
  # Docker supplies Node; no host Node/OpenSSL dependency. Never overwrite existing secrets.
  docker run --rm node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 node -e '
    const {randomBytes}=require("node:crypto");
    for (const key of ["POSTGRES_PASSWORD","JWT_SECRET","CRON_SECRET","SETUP_TOKEN"]) console.log(`${key}=${randomBytes(32).toString("hex")}`);
    console.log("APP_URL=http://localhost:8080\nPETRIOS_VERSION=0.1.0\nOPS_ENABLED=false\nOPS_ASSISTANT_ENABLED=false\nMAIL_FROM=\nRESEND_API_KEY=\nSMTP_HOST=\nSMTP_PORT=587\nSMTP_ADMIN_EMAIL=\nSMTP_USER=\nSMTP_PASS=\nSMTP_SECURE=false");
  ' > .env.tmp
  mv .env.tmp .env
fi
docker compose pull
docker compose up -d
printf '\nOpen the APP_URL from .env, then enter its SETUP_TOKEN to create your administrator.\nKeep .env private and back it up with the database and uploads.\n'
