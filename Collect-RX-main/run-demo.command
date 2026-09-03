#!/bin/bash
# CollectRx — one-click demo runner.
# Double-click this file in Finder. It asks for the phone number to call and
# the practice name up front, opens the dashboard, then waits for you to walk
# Dr. Hasan through it at your own pace — the live call only fires once you
# press Enter, so nothing rings before you're ready and nothing demo-specific
# (your phone number, the practice name) ever gets written to a config file.
cd "$(dirname "$0")"

echo "═══════════════════════════════════════════════════"
echo "   CollectRx — Demo"
echo "═══════════════════════════════════════════════════"
echo ""
read -p "Phone number for the agent to call (e.g. +16135018951): " DEMO_PHONE
if [ -z "$DEMO_PHONE" ]; then
  echo "A phone number is required. Re-run and enter one."
  read -p "Press ENTER to close this window..." _
  exit 1
fi
read -p "Practice name to use [Tenth Line Family Dentistry]: " DEMO_PRACTICE_NAME
DEMO_PRACTICE_NAME=${DEMO_PRACTICE_NAME:-"Tenth Line Family Dentistry"}

echo ""
echo "Opening dashboard..."
open "https://collect-rx.fly.dev"
echo ""
echo "Login: demo@collectrx-test.local"
echo ""
echo "Walk through claims, Analytics, Balances, Outbox — whatever you want to show."
echo ""
read -p "Press ENTER when you're ready for the live call to ring $DEMO_PHONE... " _

TEST_PHONE_NUMBER="$DEMO_PHONE" VAPI_PRACTICE_NAME="$DEMO_PRACTICE_NAME" npm run demo:call

echo ""
read -p "Press ENTER to close this window..." _
