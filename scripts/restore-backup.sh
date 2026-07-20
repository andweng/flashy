#!/usr/bin/env bash
# Restore a Flashy backup from R2 into TARGET_DB_URL.
#
#   AGE_KEY_FILE=~/flashy-backup-age.key \
#   TARGET_DB_URL=postgresql://... \
#   R2_ACCOUNT_ID=... R2_BUCKET=flashy-backups \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#     scripts/restore-backup.sh [flashy/YYYY-MM-DD.dump.age]
#
# With no key argument, restores the most recent object.
set -euo pipefail

: "${AGE_KEY_FILE:?path to your offline age private key}"
: "${TARGET_DB_URL:?postgres url to restore INTO (NOT production)}"
: "${R2_ACCOUNT_ID:?}" ; : "${R2_BUCKET:?}"
: "${AWS_ACCESS_KEY_ID:?}" ; : "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  NAME="$(aws s3 ls "s3://${R2_BUCKET}/flashy/" --endpoint-url "$ENDPOINT" \
          | awk '{print $4}' | sort | tail -1)"
  [[ -n "$NAME" ]] || { echo "no backups found in flashy/" >&2; exit 1; }
  KEY="flashy/${NAME}"
fi

echo ">> restoring ${KEY} into ${TARGET_DB_URL%%@*}@..."
aws s3 cp "s3://${R2_BUCKET}/${KEY}" backup.dump.age --endpoint-url "$ENDPOINT"
age -d -i "$AGE_KEY_FILE" -o backup.pgc backup.dump.age
pg_restore --clean --if-exists --no-owner -d "$TARGET_DB_URL" backup.pgc
rm -f backup.dump.age backup.pgc
echo ">> restore complete"
