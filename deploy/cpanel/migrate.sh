#!/bin/sh
# Applies database migrations (safe to run on every deploy; already-applied migrations are skipped).
# Run from the application root in the cPanel Terminal, inside the app's Node.js environment:
#   source ~/nodevenv/<app-root>/22/bin/activate && cd ~/<app-root>
#   sh migrate.sh            # status + apply
#   sh migrate.sh status     # only show status
#
# TAKE A DATABASE BACKUP FIRST (cPanel → Backup, or pg_dump). Migrations never drop data, but a
# backup is the rule before every production change.
set -eu
cd "$(dirname "$0")"
# only DATABASE_URL is read from .env (the file is not executed as a shell script)
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
  export DATABASE_URL
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (.env or cPanel environment variables)." >&2
  exit 1
fi
PRISMA="npx --yes prisma@6.19.3"
echo "▶ migration status"
$PRISMA migrate status --schema prisma/schema.prisma || true
if [ "${1:-}" = "status" ]; then exit 0; fi
echo "▶ applying migrations"
$PRISMA migrate deploy --schema prisma/schema.prisma
echo "✔ database is up to date"
