#!/bin/bash
# CollectRx — one-click demo runner.
# Double-click this file in Finder. It opens the dashboard, waits for you to
# walk Dr. Hasan through it at your own pace, then fires the live agent call
# the moment you press Enter — so the phone never rings before you're ready.
cd "$(dirname "$0")"

echo "═══════════════════════════════════════════════════"
echo "   CollectRx — Demo"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Opening dashboard..."
open "https://collect-rx.fly.dev"
echo ""
echo "Login: demo@collectrx-test.local"
echo ""
echo "Walk through claims, Analytics, Balances, Outbox — whatever you want to show."
echo ""
read -p "Press ENTER when you're ready for the live call to ring your phone... " _

npm run demo:call

echo ""
read -p "Press ENTER to close this window..." _
