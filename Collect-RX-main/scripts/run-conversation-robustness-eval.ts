/**
 * Run the conversation-robustness eval against the live Claims_Agent prompt
 * in vapi-squad-config.json. Simulates carrier reps giving unexpected/
 * off-script responses and judges whether the agent stays focused on
 * recovering payment for the claim.
 *
 * Live LLM calls — requires ANTHROPIC_API_KEY and COLLECTRX_ANTHROPIC_EVAL=1.
 * Not part of `npm test`. Default: disabled to prevent accidental API spend.
 *
 * Usage:
 *   npm run eval:conversation-robustness                  # all scenarios
 *   npm run eval:conversation-robustness -- bot_accusation settlement_pressure
 */
import 'dotenv/config';
import {
  CONVERSATION_ROBUSTNESS_SCENARIOS,
  runConversationRobustnessEval,
} from '../src/services/analytics/conversation-robustness-eval.js';

async function main() {
  console.log(`[DEBUG] Total scenarios available: ${CONVERSATION_ROBUSTNESS_SCENARIOS.length}`);
  console.log(`[DEBUG] Scenario IDs: ${CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => s.id).join(', ')}`);

  const requested = process.argv.slice(2);
  const unknown = requested.filter((id) => !CONVERSATION_ROBUSTNESS_SCENARIOS.some((s) => s.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown scenario id(s): ${unknown.join(', ')}`);
    console.error(`Available: ${CONVERSATION_ROBUSTNESS_SCENARIOS.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }

  const results = await runConversationRobustnessEval(requested.length ? requested : undefined);

  for (const result of results) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SCENARIO: ${result.label} (${result.scenarioId})`);
    console.log('='.repeat(70));
    for (const turn of result.conversation.turns) {
      const speaker = turn.role === 'assistant' ? 'CollectRx AI' : 'Carrier Rep ';
      console.log(`[${speaker}] ${turn.content}`);
    }
    console.log('\nJudgment:', JSON.stringify(result.judgment, null, 2));
    console.log(`Result: ${result.passed ? 'PASS' : 'FAIL'}`);
  }

  const passCount = results.filter((r) => r.passed).length;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${passCount}/${results.length} scenarios passed`);

  if (passCount < results.length) process.exit(1);
}

main().catch((err) => {
  console.error('[eval:conversation-robustness]', (err as Error).message);
  process.exit(1);
});
