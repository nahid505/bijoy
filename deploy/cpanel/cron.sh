#!/bin/sh
# cPanel cron helper — calls the app's cron endpoint without putting the secret into the crontab.
#   sh /home/USER/bijoy-lenden/cron.sh daily-check     (hourly)
#   sh /home/USER/bijoy-lenden/cron.sh sms-queue       (every 5 minutes, only if SMS is used)
set -eu
cd "$(dirname "$0")"
JOB="${1:-daily-check}"
case "$JOB" in daily-check|sms-queue) ;; *) echo "unknown job: $JOB" >&2; exit 2 ;; esac
val() { grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
CRON_SECRET="${CRON_SECRET:-$(val CRON_SECRET)}"
APP_URL="${APP_URL:-$(val APP_URL)}"
if [ -z "$CRON_SECRET" ] || [ -z "$APP_URL" ]; then
  echo "CRON_SECRET and APP_URL must be set in .env" >&2
  exit 1
fi
curl -fsS -m 300 -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/$JOB" > /dev/null
