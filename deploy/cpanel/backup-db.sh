#!/bin/sh
# Daily database backup for cPanel hosting (keeps 14 days, outside public_html).
#   cPanel cron:  30 2 * * *  /bin/sh /home/USER/bijoy-lenden/backup-db.sh >/dev/null 2>&1
# MySQL / MariaDB: mysqldump (present on cPanel servers). PostgreSQL: pg_dump.
# The password is passed through the environment, never on the command line.
set -eu
cd "$(dirname "$0")"
DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')}"
DIR="${BACKUP_DIR:-$HOME/db-backups}"
mkdir -p "$DIR"
chmod 700 "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
case "$DATABASE_URL" in
  mysql://*)
    # mysql://USER:PASSWORD@HOST:PORT/DATABASE?params  (use a password without @ : / ? # characters)
    REST="${DATABASE_URL#mysql://}"
    CRED="${REST%%@*}"; HOSTPART="${REST#*@}"
    DB_USER="${CRED%%:*}"; DB_PASS="${CRED#*:}"
    HOSTPORT="${HOSTPART%%/*}"; DB_NAME="${HOSTPART#*/}"; DB_NAME="${DB_NAME%%\?*}"
    DB_HOST="${HOSTPORT%%:*}"; DB_PORT="3306"
    case "$HOSTPORT" in *:*) DB_PORT="${HOSTPORT##*:}" ;; esac
    FILE="$DIR/bijoy-lenden-$STAMP.sql.gz"
    MYSQL_PWD="$DB_PASS" mysqldump --single-transaction --quick --no-tablespaces --routines --default-character-set=utf8mb4 \
      -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" | gzip -9 > "$FILE"
    ;;
  postgres*://*)
    URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/[?&](schema|connection_limit|pool_timeout|connect_timeout)=[^&]*//g')"
    FILE="$DIR/bijoy-lenden-$STAMP.sql.gz"
    pg_dump --no-owner --no-privileges "$URL" | gzip -9 > "$FILE"
    ;;
  *) echo "DATABASE_URL is not set" >&2; exit 1 ;;
esac
chmod 600 "$FILE"
find "$DIR" -name 'bijoy-lenden-*.sql.gz' -mtime +14 -delete
echo "backup: $FILE"
