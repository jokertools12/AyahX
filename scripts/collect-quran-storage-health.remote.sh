#!/usr/bin/env bash
# Run inside the MySQL container after migration003. No audio or credentials saved.
set -euo pipefail
test "${MYSQL_DATABASE:-}" = railway
while true; do
  read -r total available < <(df -B1 --output=size,avail /var/lib/mysql | tail -n 1)
  [[ "$total" =~ ^[0-9]+$ && "$available" =~ ^[0-9]+$ ]] || exit 2
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --batch --skip-column-names -u root "$MYSQL_DATABASE" \
    -e "INSERT INTO quran_storage_health(id,total_bytes,available_bytes,observed_at) VALUES(1,$total,$available,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE total_bytes=VALUES(total_bytes),available_bytes=VALUES(available_bytes),observed_at=VALUES(observed_at)" \
    2>/dev/null || { printf '%s\n' 'AYAHX_STORAGE_COLLECTION_FAILED' >&2; exit 3; }
  sleep 60
done
