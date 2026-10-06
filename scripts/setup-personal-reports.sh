#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pilot_home="${FLO_PILOT_HOME:-$HOME/flo-private}"
"$pilot_home/venv/bin/pip" install reportlab
if [[ ! -f "$pilot_home/report-email.json" ]]; then
  read -r -s -p 'Resend API key (hidden): ' RESEND_API_KEY
  printf '\n'
  read -r -p 'Verified sender email address: ' FLO_REPORT_FROM
  export RESEND_API_KEY FLO_REPORT_FROM
  node scripts/configure-personal-reports.mjs
  unset RESEND_API_KEY FLO_REPORT_FROM
fi
node scripts/install-personal-reports.mjs
