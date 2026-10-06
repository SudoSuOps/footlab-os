#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pilot_home="${FLO_PILOT_HOME:-$HOME/flo-private}"
if [[ ! -f "$pilot_home/twilio.json" ]]; then
  read -r -p 'Twilio Account SID: ' TWILIO_ACCOUNT_SID
  read -r -s -p 'Twilio Auth Token: ' TWILIO_AUTH_TOKEN
  printf '\n'
  export TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN
  export TWILIO_FROM_NUMBER='+15615818015'
  node scripts/configure-sms.mjs
  unset TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER
fi
node scripts/install-personal-daily.mjs
