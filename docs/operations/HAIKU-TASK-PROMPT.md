# Paste-ready prompt for a Haiku session (copy everything below the line)

---

Work in `/Users/khalidegeh/Desktop/Dentist/collectrx-platform`. First read `docs/operations/BUILD-HANDOFF.md` — it is the source of truth. Your job is ONLY §1 of that file plus one SQL backfill. Follow the steps below exactly. Do not improvise.

## Hard rules (stop conditions)
- Do NOT edit `vapi-squad-config.json`, any prompt, or any source file.
- Do NOT run `npm run eval:conversation-robustness` (it costs money).
- Do NOT deploy or touch the production app (`collect-rx`). Staging only.
- Run at most ONE voice round, plus ONE retry if the call itself errors (not if it fails the criteria).
- If any step fails twice, STOP and report exactly what you saw. Do not debug, do not iterate on prompts.
- Do not print values from `.env`.

## Task A — deploy staging and verify the payment tool (round 7)

1. Deploy staging (local `fly deploy` is broken by clock drift — use CI):
   ```bash
   gh workflow run collectrx-staging-deploy.yml --repo GetCollectRx/Collect-RX
   ```
   Poll `gh run list --repo GetCollectRx/Collect-RX --workflow "CollectRx staging deploy" --limit 1` every 60s until `completed success`. If `failure`, STOP and report the failed-step log.

2. Confirm the tool endpoint answers (from `Collect-RX-main/`):
   ```bash
   cd Collect-RX-main
   SECRET=$(grep -m1 '^VAPI_WEBHOOK_SECRET=' .env | cut -d= -f2)
   curl -s -X POST https://collect-rx-staging.fly.dev/api/webhooks/vapi \
     -H "x-vapi-secret: $SECRET" -H 'Content-Type: application/json' \
     -d '{"message":{"type":"tool-calls","toolWithToolCallList":[{"name":"verify_payment_amount","toolCall":{"id":"tc_1","function":{"name":"verify_payment_amount","arguments":"{\"statedAmount\":\"410\",\"expectedAmount\":\"1250\"}"}}}]}}'
   ```
   PASS = HTTP 200 JSON whose `results[0].result` contains `SHORTFALL DETECTED`. If not, STOP and report the response.

3. Launch the voice round (from `Collect-RX-main/`):
   ```bash
   node -e "
   const fs=require('fs');const env=fs.readFileSync('.env','utf8');
   const key=(env.match(/^VAPI_API_KEY=(.+)$/m)||[])[1].trim();
   (async()=>{
     const nums=await fetch('https://api.vapi.ai/phone-number',{headers:{Authorization:'Bearer '+key}}).then(r=>r.json());
     const twilio=nums.find(p=>p.provider==='twilio');
     const call=await fetch('https://api.vapi.ai/call',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({assistantId:'a3180f2c-e85f-4c42-872d-1d20be57c7eb',phoneNumberId:twilio.id,customer:{number:'+19518486241'}})}).then(r=>r.json());
     console.log('round 7:',call.id,call.status);
     fs.writeFileSync('/tmp/round7-call-id.txt',call.id);
   })()"
   ```
   Poll the call every 60s until `status` is `ended`:
   ```bash
   KEY=$(grep -m1 '^VAPI_API_KEY=' .env | cut -d= -f2)
   curl -s https://api.vapi.ai/call/$(cat /tmp/round7-call-id.txt) -H "Authorization: Bearer $KEY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status'), d.get('endedReason',''))"
   ```

4. Score it. Fetch the OTHER leg (the inbound squad call created within minutes of the sim call) from `GET https://api.vapi.ai/call?limit=6`; on that leg check:
   - a `tool_call_result` message with `name: "verify_payment_amount"` whose `result` contains `SHORTFALL DETECTED` (NOT "No result returned")
   - the transcript shows the agent asking why the payment is short
   - `analysis.structuredData.outcome` is `PARTIAL_PAYMENT` (may take ~2 min after call end to appear)

5. Report PASS/FAIL per criterion with short quotes. If ALL pass, edit `docs/operations/BUILD-HANDOFF.md`: mark the two §1 checkboxes like this — first one `[x] ... VERIFIED round 7 <date>`, second stays `[ ]` but append "(round 7 green — awaiting operator go)". Commit exactly that one file:
   ```bash
   git add docs/operations/BUILD-HANDOFF.md && git commit -m "Round 7 green: verify_payment_amount tool verified end-to-end" && git push origin main
   ```

## Task B — staging trialEndsAt backfill (BUILD-HANDOFF §3 A2)

1. Write this file to `/tmp/backfill.ts` exactly:
   ```ts
   import { prisma } from '/app/src/lib/prisma.js';
   import { runWithRlsBypass } from '/app/src/server/db/rlsContext.js';

   async function main() {
     await runWithRlsBypass(async () => {
       const rows = await prisma.$executeRaw`
         UPDATE "Practice"
         SET trial_ends_at = created_at + interval '30 days'
         WHERE billing_tier = 'trial' AND trial_ends_at IS NULL`;
       console.log('backfilled rows:', rows);
     });
     await prisma.$disconnect();
   }
   main().catch((e) => { console.error(e); process.exit(1); });
   ```
   Note: the table may be mapped `"practices"` — if the run errors with a missing-table name, replace `"Practice"` with `"practices"` (that is the ONE permitted variation) and run once more.

2. Upload and run it on the staging VM (this base64 pattern is proven — use it verbatim):
   ```bash
   export PATH="$HOME/.fly/bin:$PATH"
   B64=$(base64 -i /tmp/backfill.ts | tr -d '\n')
   flyctl ssh console -a collect-rx-staging --select=false -C "sh -c \"echo $B64 | base64 -d > /tmp/backfill.ts && cd /app && ./node_modules/.bin/tsx /tmp/backfill.ts\""
   ```
   If `flyctl` errors with anything auth/TLS-related, STOP and report "local clock drift — operator must sync the Mac clock" (known issue, BUILD-HANDOFF §3 B4).

3. On success, report the row count and update BUILD-HANDOFF §3 item A2 with "staging DONE <date>" in the same commit style as Task A.

## Final report format
Three lines: Task A result (pass/fail + which criteria), Task B result (rows backfilled or blocked), anything that needs the operator. Nothing else.
