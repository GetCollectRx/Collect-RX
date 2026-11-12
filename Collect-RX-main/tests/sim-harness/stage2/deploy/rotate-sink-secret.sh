#!/usr/bin/env bash
# Makes a new sink secret, sets it on the Fly twin, and points the Vapi TEST clones at it.
# Touches only the 5 cloned Vapi objects listed below (never the production squad). The secret is never printed.
# Needs: fly (logged in), curl, python3, openssl. Run from any folder.
set -euo pipefail

VAPI_BASE="${VAPI_BASE:-https://api.vapi.ai}"
FLY_APP="${FLY_APP:-collectrx-carrier-twin}"
SINK_URL="${SINK_URL:-https://collectrx-carrier-twin.fly.dev/sink}"
TOOLS="9a2b49da-2096-4e74-9bc7-b1b9b304c5fe 4dc6280f-8f19-4776-aa9c-5cbd96494dac"
ASSISTANTS="0581e6ae-36ce-4b88-8e8c-07224751ce10 2c2cfbe5-efce-41fe-a3d3-9a7e8b1ad2fb c66b24c3-e53a-46eb-a124-979d0810e5d0"

if [ -z "${VAPI_KEY:-}" ]; then
  read -r -s -p "Vapi private key: " VAPI_KEY; echo
fi
SINK="$(openssl rand -hex 24)"

patch_one() { # kind id
  local kind="$1" id="$2" cur body code
  cur="$(curl -fsS "$VAPI_BASE/$kind/$id" -H "Authorization: Bearer $VAPI_KEY")"
  body="$(CUR="$cur" SINK="$SINK" SINK_URL="$SINK_URL" python3 -I -c '
import json, os
cur = json.loads(os.environ["CUR"])
srv = cur.get("server") or {}
print(json.dumps({"server": {"url": os.environ["SINK_URL"], "timeoutSeconds": srv.get("timeoutSeconds", 20), "secret": os.environ["SINK"]}}))')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$VAPI_BASE/$kind/$id" -H "Authorization: Bearer $VAPI_KEY" -H 'Content-Type: application/json' -d "$body")"
  [ "$code" = "200" ] || { echo "FAILED $kind $id (HTTP $code)"; exit 1; }
  echo "updated $kind $id"
}

for id in $TOOLS; do patch_one tool "$id"; done
for id in $ASSISTANTS; do patch_one assistant "$id"; done

# Fly last: if a Vapi update failed above, the twin keeps its old state.
fly secrets set TWIN_SINK_SECRET="$SINK" -a "$FLY_APP"
unset SINK VAPI_KEY
echo "Done. Next: fly deploy -a $FLY_APP (from the twin-deploy folder)"
