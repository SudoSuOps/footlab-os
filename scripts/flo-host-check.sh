#!/usr/bin/env bash
# Read-only deployment inventory. Never read environment files or client media.
set -u
printf 'FLO HOST CHECK v1\n'
printf 'Host: %s\n' "$(hostname)"
printf 'Node: %s\n' "$(node --version 2>/dev/null || printf unavailable)"
printf 'Python: %s\n' "$(python3 --version 2>/dev/null || printf unavailable)"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf '\nRepository\n'
  git rev-parse --show-toplevel
  git branch --show-current
  git rev-parse --short HEAD
  printf 'Tracked changes: '
  git diff --name-only | wc -l
  printf 'Staged changes: '
  git diff --cached --name-only | wc -l
fi

printf '\nRelevant service states (names only)\n'
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --all --type=service --no-legend --no-pager 2>/dev/null |
    awk 'tolower($0) ~ /footos|footlab|flo[-_.]|caddy|postgres|cloudflared/ {print $1, $2, $3, $4}'
else
  printf 'systemctl unavailable\n'
fi

printf '\nKnown deployment paths (existence only)\n'
for path in /opt/footos /opt/footlab /opt/footlab-os /etc/caddy/Caddyfile /var/lib/footos /mnt/synology/openfootlab/footos; do
  if [ -e "$path" ]; then printf 'present %s\n' "$path"; else printf 'absent or inaccessible %s\n' "$path"; fi
done
printf '\nIssuer location\n'
command -v footos-checkin || true

printf '\nLocal TCP listeners (addresses only)\n'
if command -v ss >/dev/null 2>&1; then
  ss -ltnH 2>/dev/null | awk '$4 ~ /:(80|443|8000|4174|5432)$/ {print $4}'
fi

printf '\nLocal capture HTTP response (status only)\n'
if command -v curl >/dev/null 2>&1; then
  curl --silent --output /dev/null --max-time 3 --write-out '127.0.0.1:8000 HTTP %{http_code}\n' http://127.0.0.1:8000/ || true
fi
printf '\nFinished. No secrets, logs, database rows or photos were read.\n'
