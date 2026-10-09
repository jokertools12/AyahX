set -euo pipefail

# This process never writes a dump or credentials to disk. SQL arrives only in
# framed stdin, and one mysql process serves the complete session.
test "${MYSQL_DATABASE:-}" = railway || { printf '%s\n' AYAHX_DATABASE_NOT_APPROVED >&2; exit 64; }
command -v base64 >/dev/null || { printf '%s\n' AYAHX_BASE64_MISSING >&2; exit 69; }
compression=plain
if command -v gunzip >/dev/null; then compression=gzip; fi
coproc AYAHX_MYSQL {
  MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?}" mysql --default-character-set=utf8mb4 --batch --raw --skip-column-names --unbuffered --binary-mode -u root "$MYSQL_DATABASE"
}
mysql_pid=$AYAHX_MYSQL_PID
mysql_in_fd=${AYAHX_MYSQL[1]}
mysql_out_fd=${AYAHX_MYSQL[0]}
exec 3>&"$mysql_in_fd"
exec 4<&"$mysql_out_fd"
# Do not retain a second write descriptor: closing fd 3 must deliver EOF to
# mysql, otherwise CLOSE would wait forever for a process still reading stdin.
exec {mysql_in_fd}>&-
exec {mysql_out_fd}<&-
trap 'kill "$mysql_pid" 2>/dev/null || true' EXIT
printf 'AYAHX_SERIAL_READY\t1\t%s\n' "$compression"
closed=0
while IFS=$'\t' read -r mode marker payload; do
  if [[ ! "$marker" =~ ^[a-f0-9]{32}_[0-9]+$ ]]; then
    printf '%s\n' AYAHX_FRAME_MARKER_INVALID >&2; exit 64
  fi
  if [[ "$mode" = C && "$payload" = - ]]; then
    exec 3>&-
    if wait "$mysql_pid"; then
      closed=1
      printf 'AYAHX_SERIAL_CLOSED\t%s\t0\n' "$marker"
      break
    else
      status=$?
      printf '%s\n' AYAHX_MYSQL_CLOSE_FAILED >&2
      exit "$status"
    fi
  fi
  [[ "$mode" = P || ( "$mode" = G && "$compression" = gzip ) ]] || { printf '%s\n' AYAHX_FRAME_MODE_INVALID >&2; exit 64; }
  [[ "$payload" =~ ^[A-Za-z0-9+/=]+$ ]] || { printf '%s\n' AYAHX_FRAME_PAYLOAD_INVALID >&2; exit 64; }
  printf 'AYAHX_SERIAL_BEGIN\t%s\n' "$marker"
  if [[ "$mode" = G ]]; then
    if ! printf %s "$payload" | base64 -d | gunzip -c >&3; then
      printf '%s\n' AYAHX_FRAME_DECODE_FAILED >&2; exit 74
    fi
  else
    if ! printf %s "$payload" | base64 -d >&3; then
      printf '%s\n' AYAHX_FRAME_DECODE_FAILED >&2; exit 74
    fi
  fi
  printf "\nSELECT '%s';\n" "$marker" >&3
  acknowledged=0
  while IFS= read -r line <&4; do
    if [[ "$line" = "$marker" ]]; then
      acknowledged=1
      printf 'AYAHX_SERIAL_ACK\t%s\n' "$marker"
      break
    fi
    printf '%s\n' "$line"
  done
  if [[ "$acknowledged" != 1 ]]; then
    status=70
    wait "$mysql_pid" || status=$?
    printf '%s\n' AYAHX_SQL_NOT_ACKNOWLEDGED >&2
    exit "$status"
  fi
done
if [[ "$closed" != 1 ]]; then
  printf '%s\n' AYAHX_CLOSE_FRAME_REQUIRED >&2
  exit 74
fi
trap - EXIT
