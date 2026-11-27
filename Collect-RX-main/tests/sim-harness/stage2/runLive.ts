/**
 * One-scenario live run against the Carrier Twin.
 *
 *   npx tsx tests/sim-harness/stage2/runLive.ts --scenario rbc.baseline --live \
 *     --max-spend-usd 10 --rate-per-minute-usd 0.5
 *
 * Network credentials are injected by the environment's proxy, so no key is read
 * here. Uses only synthetic fixtures. The destination can only be the one twin number.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarrierId } from '@prisma/client';
import { initiateCall, CARRIER_PHONE_MAP, type VapiCallParams } from '../../../src/vapi/client.js';
import { OutboundInterceptor } from '../outboundInterceptor.js';
import { allScenarios } from './scenarios.js';
import { authorizeLive, parseArgs, placeAndWait, planRun, retarget, type DialPayload } from './liveRunner.js';
import { joinCall, fetchTwinEvents, type GlueDeps } from './liveGlue.js';
import { failures, scoreCall } from './scoring.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CARRIERS_DIR = path.resolve(here, '../../../carriers');
const TWIN_BASE = process.env.TWIN_BASE_URL ?? 'https://collectrx-carrier-twin.fly.dev';
const TEST_SQUAD_ID = '4a7092f8-1137-41e4-a598-afc408ba3d1b';
const SOURCE_PHONE_NUMBER_ID = 'a4003bab-7509-44bd-9af4-7c9e1e7e6e73';

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function syntheticParams(carrierId: CarrierId): VapiCallParams {
  return {
    claimId: `claim-${carrierId}`,
    carrierId,
    practiceId: 'practice-stage2',
    patientToken: '3b241101-e2bb-4255-8caf-4136c566a962',
    patientName: 'Zephyrine Quillfeather',
    patientDob: '1984-03-17',
    policyNumber: '9900002277',
    carrierPhone: CARRIER_PHONE_MAP[carrierId as Exclude<CarrierId, 'other'>],
    claimNumber: 'OFC-STAGE2-1',
    daysOutstanding: 45,
    billedAmount: 1180,
    outstandingAmount: 742.5,
    practiceName: 'SYNTHETIC ONLY Stage 2 Dental',
    // The live IVR_Navigator prompt reads these two; left empty the agent has nothing to key in at the provider ID prompt.
    practiceNpi: '9900003',
    practiceTaxId: '9900004',
    providerNumber: '9900001',
    practicePhone: '+16135550101',
    idempotencyKey: `stage2-live-${Date.now()}`,
  };
}

async function capturePayload(carrierId: CarrierId): Promise<DialPayload> {
  process.env.VAPI_API_KEY = 'stage2-placeholder-not-a-key';
  process.env.VAPI_PHONE_NUMBER_ID = SOURCE_PHONE_NUMBER_ID;
  process.env.VAPI_SQUAD_ID = TEST_SQUAD_ID;
  const interceptor = new OutboundInterceptor();
  interceptor.install();
  try {
    await initiateCall(syntheticParams(carrierId));
    const dial = interceptor.dials()[0];
    if (!dial) throw new Error('[stage2] product initiateCall produced no dial payload');
    return JSON.parse(JSON.stringify(dial.body)) as DialPayload;
  } finally {
    interceptor.uninstall();
  }
}

async function main(): Promise<void> {
  const scenarioId = flag('--scenario') ?? 'rbc.baseline';
  const twinNumber = process.env.STAGE2_TWIN_NUMBER ?? '';
  const sc = allScenarios(CARRIERS_DIR).find((s) => s.id === scenarioId);
  if (!sc) throw new Error(`[stage2] unknown scenario ${scenarioId}`);
  const args = parseArgs(process.argv.slice(2));
  const plan = planRun([{ id: sc.id, maxCallSeconds: Math.min(sc.expect.maxCallSeconds, 6 * 60) }], args.ratePerMinuteUsd ?? 0, args.capUsd ?? 0);
  console.warn('[stage2] plan', JSON.stringify(plan));
  const auth = authorizeLive(args, plan);
  if (!auth.ok) {
    console.warn(`[stage2] ${auth.reason}`);
    return;
  }

  const realFetch = globalThis.fetch;
  const original = await capturePayload(sc.carrierId as CarrierId);
  const payload = { ...retarget(original, twinNumber, twinNumber), squadId: TEST_SQUAD_ID, phoneNumberId: SOURCE_PHONE_NUMBER_ID };
  if (payload.customer.number !== twinNumber) throw new Error('[stage2] payload not aimed at the twin');

  const armedAt = Date.now();
  const arm = await realFetch(`${TWIN_BASE}/twin/arm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenarioId: sc.id }) });
  if (!arm.ok) throw new Error(`[stage2] arming ${sc.id} failed with ${arm.status}`);
  console.warn(`[stage2] armed ${sc.id}; placing one call to ${twinNumber}`);

  const record = await placeAndWait(
    { fetchImpl: realFetch, baseUrl: 'https://api.vapi.ai', apiKey: 'proxy-injected', sleep: (ms) => new Promise((r) => setTimeout(r, ms)), pollMs: 5000, timeoutMs: 8 * 60_000 },
    payload,
  );
  console.warn(`[stage2] call ${record.id} ended: ${record.endedReason}`);

  const deps: GlueDeps = { fetchImpl: realFetch, twinBaseUrl: TWIN_BASE, controlToken: 'proxy-injected' };
  let joined: ReturnType<typeof joinCall> | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 12 && joined === null; attempt += 1) {
    try {
      joined = joinCall(await fetchTwinEvents(deps), { scenarioId: sc.id, vapiCallId: record.id, sinceMs: armedAt - 60_000 });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (joined === null) throw new Error(`[stage2] could not join events: ${lastError}`);

  const checks = scoreCall(sc, joined.twinEvents, joined.observation);
  console.warn(JSON.stringify({ scenario: sc.id, vapiCallId: record.id, endedReason: joined.endedReason, cost: joined.cost, observation: { ...joined.observation, assistantUtterances: joined.observation.assistantUtterances.length }, checks, failed: failures(checks).map((c) => c.name), twinEventKinds: joined.twinEvents.map((e) => `${e.at - joined.observation.dialedAt}ms ${e.kind}`), limitations: joined.limitations }, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
