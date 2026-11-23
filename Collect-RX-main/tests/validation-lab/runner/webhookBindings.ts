/**
 * Post-call bindings that need the signed webhook route, the database and the
 * real queue tick: E001 to E003, E006, E007, P011 to P013, P015 to P018 and
 * P025 to P030. Level S: real pipeline and routes, stubbed Vapi, synthetic data.
 *
 * Data policy (register D-01): synthetic carrier phrases and synthetic names exist
 * only in memory during the run. Bindings report codes and booleans, never text.
 * The runner test fails if any phrase or tracked identifier reaches an artifact.
 */
import { PHRASES, claimStatusPhrasesForLeakCheck } from './webhookPhrases.js';
import { getPhase5CallKpis } from '../../../src/server/services/phase5CallKpis.js';
import { classifyOutcome } from '../../../src/outcome/processor.js';
import { logger } from '../../../src/server/observability/logger.js';
import { officeRow } from '../../sim-harness/officeFixtures.js';
import { predictClaimStatus } from './postCallBindings.js';
import { fail, finding, pass, verdict, type Binding, type BindingResult } from './types.js';
import type { EndOptions, LiveCall, StatefulWorld } from './statefulWorld.js';

const TERMINAL = new Set(['RESOLVED', 'DENIED', 'ESCALATED', 'APPROVED_PENDING_PAYMENT']);
const FAILED_OUTCOMES = new Set(['FAILED', 'NO_ANSWER', 'HUNG_UP']);

export { claimStatusPhrasesForLeakCheck };

interface Observed {
  http: number;
  claimStatus: string;
  attemptOutcome: string;
  completed: boolean;
  queueStatus: string;
  queueAttempts: number;
  nextRecall: boolean;
  transcriptStored: boolean;
  appealDeadline: boolean;
  referenceCaptured: boolean;
}

export function buildWebhookBindings(world: StatefulWorld): Record<string, Binding> {
  const { plain } = world;

  async function observe(call: LiveCall, http: number): Promise<Observed> {
    const claim = await plain.insuranceClaim.findUnique({ where: { id: call.claimId }, select: { status: true, appealDeadline: true } });
    const attempt = await plain.callAttempt.findUnique({ where: { id: call.attemptId }, select: { completedAt: true, outcome: true, transcriptText: true, referenceNumber: true } });
    const queue = await plain.callQueue.findFirst({ where: { claimId: call.claimId }, select: { status: true, attempts: true, nextRecallAt: true } });
    return {
      http,
      claimStatus: claim?.status ?? 'none',
      attemptOutcome: attempt?.outcome ?? 'none',
      completed: Boolean(attempt?.completedAt),
      queueStatus: queue?.status ?? 'none',
      queueAttempts: queue?.attempts ?? -1,
      nextRecall: Boolean(queue?.nextRecallAt),
      transcriptStored: Boolean(attempt?.transcriptText),
      appealDeadline: Boolean(claim?.appealDeadline),
      referenceCaptured: Boolean(attempt?.referenceNumber),
    };
  }

  async function oneCall(label: string, rowDays: number, end: EndOptions, carrier?: string): Promise<{ call: LiveCall; obs: Observed } | null> {
    const office = await world.makeOffice({ label });
    await world.importRows(office.id, [{ tag: label.replace(/\W/gu, '').slice(0, 8), opts: { days: rowDays, ...(carrier ? { carrier } : {}) } }]);
    const call = await world.dial(office);
    if (!call) return null;
    const res = await world.endCall(call, end);
    return { call, obs: await observe(call, res.status) };
  }

  const noCall = (): BindingResult => ({ status: 'UNVERIFIED', level: 'S', observed: 'no call was dispatched', proves: 'The tick produced no call, so the post-call path was not reached.' });
  const fmt = (o: Observed): string => `http=${o.http} completed=${o.completed} outcome=${o.attemptOutcome} claim=${o.claimStatus} queue=${o.queueStatus} attempts=${o.queueAttempts} nextRecall=${o.nextRecall}`;

  const unconnected = (label: string, reason: string, probeCap: boolean): Binding => async () => {
    const r = await oneCall(label, 45, { reason, seconds: reason === 'silence-timed-out' ? 1800 : 95 });
    if (!r) return noCall();
    const o = r.obs;
    const firstOk = o.http === 200 && o.completed && FAILED_OUTCOMES.has(o.attemptOutcome) && !TERMINAL.has(o.claimStatus) && o.queueStatus === 'PENDING';
    if (!probeCap) {
      return verdict(firstOk, 'S', fmt(o), 'The call that never reached a person is closed as a failed attempt, the claim is not left in a terminal state, and the queue entry stays pending for another attempt. Retry spacing is covered by office-day E.');
    }
    // Repeat failures on a fresh claim to see how many calls the cap of 3 attempts really allows.
    const office = await world.makeOffice({ label: `${label} cap` });
    await world.importRows(office.id, [{ tag: 'CAP', opts: { days: 45 } }]);
    let dials = 0;
    let last: LiveCall | null = null;
    for (let i = 0; i < 5; i += 1) {
      const call = await world.dial(office);
      if (!call) break;
      dials += 1;
      last = call;
      await world.endCall(call, { reason, seconds: 1800 });
      await world.freeLines(office.id);
      await plain.callQueue.updateMany({ where: { claimId: call.claimId, status: 'PENDING' }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    }
    const end = last ? await observe(last, 200) : null;
    const evidence = `${fmt(o)} | repeated failures: calls placed before the claim stopped ${dials}; final claim=${end?.claimStatus ?? 'none'} queue=${end?.queueStatus ?? 'none'} attempts=${end?.queueAttempts ?? -1}`;
    if (!firstOk) return fail('S', evidence, 'The first failed call was not closed as a failed, retryable attempt.');
    if (dials < 3) {
      return finding('S', evidence, 'A failed call is closed correctly and the claim stays retryable, but the queue attempt count goes up twice per failed call (once at dispatch, once when the recovery step requeues it). The cap of 3 attempts is therefore reached after fewer than 3 calls. Retry spacing is not applied in this probe.');
    }
    return verdict(dials === 3, 'S', evidence, 'A failed call is closed correctly, stays retryable, and the cap allows exactly 3 calls.');
  };

  const duplicate = (label: string): Binding => async () => {
    const office = await world.makeOffice({ label });
    await world.importRows(office.id, [{ tag: label.slice(0, 8), opts: { days: 45 } }]);
    const call = await world.dial(office);
    if (!call) return noCall();
    const end: EndOptions = { transcript: PHRASES.paidWithRef, seconds: 600 };
    const first = await world.endCall(call, end);
    const snapshot = async (): Promise<string> => {
      const attempts = await plain.callAttempt.count({ where: { claimId: call.claimId } });
      const a = await plain.callAttempt.findUnique({ where: { id: call.attemptId }, select: { completedAt: true, minutesBilled: true } });
      const usage = await plain.usagePeriod.findMany({ where: { practiceId: office.id }, select: { minutesConsumed: true } });
      const c = await plain.insuranceClaim.findUnique({ where: { id: call.claimId }, select: { status: true } });
      return `attempts=${attempts} completedAt=${a?.completedAt?.toISOString() ?? 'none'} minutesBilled=${a?.minutesBilled ?? 'none'} usage=${usage.reduce((n, u) => n + u.minutesConsumed, 0)} claim=${c?.status ?? 'none'}`;
    };
    const before = await snapshot();
    const second = await world.postWebhook(world.envelope(call, end));
    const after = await snapshot();
    return verdict(first.status === 200 && second.status === 200 && before === after, 'S', `first http=${first.status} second http=${second.status}; unchanged=${before === after}`, 'Redelivering the same end-of-call report changes nothing: same completion time, minutes billed once, same claim status, no second attempt row.');
  };

  const secondName = (): { first: string; last: string } => {
    const decoy = officeRow('DECOY');
    world.trackRows([decoy]);
    return { first: decoy.patient_first_name, last: decoy.patient_last_name };
  };

  return {
    E001: unconnected('E001 hold timeout', 'silence-timed-out', true),
    E002: unconnected('E002 connection lost', 'phone-call-provider-closed-websocket', false),

    E003: async () => {
      const full = await oneCall('E003 full metadata', 45, { transcript: PHRASES.paidWithRef });
      const bare = await oneCall('E003 bare metadata', 45, { transcript: PHRASES.paidWithRef, metadata: 'none' });
      if (!full || !bare) return noCall();
      const evidence = `with claim metadata: outcome=${full.obs.attemptOutcome} claim=${full.obs.claimStatus} | metadata stripped from the report: outcome=${bare.obs.attemptOutcome} claim=${bare.obs.claimStatus}`;
      if (full.obs.attemptOutcome !== 'RESOLVED' || full.obs.claimStatus !== 'RESOLVED') return fail('S', evidence, 'The outcome did not reach the claim even with the claim metadata present.');
      if (bare.obs.attemptOutcome === 'none') {
        return finding('S', evidence, 'With the claim metadata on the end-of-call report the outcome lands on the right claim. If a report arrives without it, the outcome is dropped and the claim stays CALLING, because the route needs the metadata to find the practice and does not fall back to the call id. A real Vapi report keeps its metadata, so this is a dependency, not a proven defect. Agent-to-agent handoff inside Vapi is not exercised.');
      }
      return pass('S', evidence, 'The outcome lands on the right claim with or without the claim metadata.');
    },

    E006: duplicate('E006 duplicate end'),
    P011: duplicate('P011 duplicate hook'),

    E007: async () => {
      const office = await world.makeOffice({ label: 'E007 db write fails' });
      const [claimId] = await world.importRows(office.id, [{ tag: 'E007', opts: { days: 45 } }]);
      // A row that already owns the next stub call id makes the post-dispatch write fail on the unique key.
      await plain.callAttempt.create({ data: { claimId: claimId ?? '', vapiCallId: world.nextSimCallId(), initiatedAt: new Date(), completedAt: new Date() } });
      const before = world.controlRequests().length;
      const t = await world.tickFor(office.id);
      const ends = world.controlRequests().slice(before).filter((r) => JSON.stringify(r.body).includes('end-call')).length;
      await world.freeLines(office.id);
      return verdict(t.dials.length === 1 && ends >= 1, 'S', `dials ${t.dials.length}; end-call commands sent after the failed write ${ends}`, 'When the database write fails after Vapi accepted the call, the product ends the live call instead of leaving an orphan. The failure is forced with a unique key clash, not a real outage.');
    },

    P012: async () => {
      const office = await world.makeOffice({ label: 'P012 phi scrub' });
      await world.importRows(office.id, [{ tag: 'P012', opts: { days: 45 } }]);
      const row = world.lastRows[0];
      const call = await world.dial(office);
      if (!call || !row) return noCall();
      const transcript = `${PHRASES.paidWithRef} The caller gave ${row.patient_first_name} ${row.patient_last_name}, member ${row.subscriber_id}, group ${row.group_policy_number}.`;
      const res = await world.endCall(call, { transcript });
      const stored = (await plain.callAttempt.findUnique({ where: { id: call.attemptId }, select: { transcriptText: true } }))?.transcriptText ?? null;
      const lower = (stored ?? '').toLowerCase();
      const leaked = [row.patient_first_name, row.patient_last_name, row.subscriber_id, row.group_policy_number].filter((v) => lower.includes(v.toLowerCase())).length;
      const evidence = `http=${res.status}; identifiers found in stored transcript ${leaked}; transcript stored at rest ${stored !== null}`;
      if (leaked > 0) return fail('S', evidence, 'A patient identifier from the call survived into call_attempts.transcript_text.');
      if (stored !== null) {
        return finding('S', evidence, 'Known identifiers are removed before storage, so no patient information is persisted. But the redacted transcript is still stored at rest in call_attempts.transcript_text. Register D-01 and the brief say transcripts are not kept at rest by default; this is the gap the handoff item 4 describes.');
      }
      return pass('S', evidence, 'No identifier and no transcript is stored.');
    },

    P013: async () => {
      const decoy = secondName();
      const r = await oneCall('P013 conflated names', 45, { transcript: `${decoy.first} ${decoy.last}: ${PHRASES.paidWithRef}` });
      if (!r) return noCall();
      const o = r.obs;
      return o.claimStatus === 'RESOLVED'
        ? fail('S', fmt(o), 'The rep named a different patient than the claim, and the claim was still closed as RESOLVED. Nothing in the outcome path compares the names spoken on the call with the claim. A spoken reference number is all the financial gate asks for.')
        : pass('S', fmt(o), 'A call that names a different patient is not auto-resolved.');
    },

    P015: async () => {
      const office = await world.makeOffice({ label: 'P015 over 90 in call' });
      await world.importRows(office.id, [{ tag: 'P015', opts: { days: 45 } }]);
      const call = await world.dial(office);
      if (!call) return noCall();
      const res = await world.endCall(call, { transcript: PHRASES.pastFilingLimit });
      const o = await observe(call, res.status);
      const esc = await plain.callEscalation.count({ where: { claimId: call.claimId } });
      const evidence = `${fmt(o)} callEscalations=${esc}`;
      return o.claimStatus === 'ESCALATED' || esc > 0
        ? pass('S', evidence, 'A rep saying the claim is past the filing limit sends it to a human.')
        : finding('S', evidence, 'The registry line "90+ days in transcript" is ambiguous. Interpretation used: the rep says the claim is past a 90 day limit. The claim is not escalated: only the claim age the system holds (dispatch rule D002) triggers the over-90 escalation, wording in the call does not. The scenario needs a clearer definition before this can be a PASS or a FAIL.');
    },

    P016: async () => {
      const office = await world.makeOffice({ label: 'P016 recording delete' });
      await world.importRows(office.id, [{ tag: 'P016', opts: { days: 45 } }]);
      const call = await world.dial(office);
      if (!call) return noCall();
      const before = world.recordingDeletes().length;
      await world.endCall(call, { transcript: PHRASES.paidWithRef });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const deletes = world.recordingDeletes().slice(before).filter((r) => r.path.includes(call.vapiCallId)).length;
      return verdict(deletes >= 1, 'S', `recording delete requests for this call ${deletes}`, 'After the call ends the product asks the vendor to delete the recording (stubbed here). Whether the vendor deletes it is not proved.');
    },

    P017: async () => {
      const office = await world.makeOffice({ label: 'P017 appeal metadata' });
      const [claimId] = await world.importRows(office.id, [{ tag: 'P017', opts: { days: 45 } }]);
      const preset = Boolean((await plain.insuranceClaim.findUnique({ where: { id: claimId ?? '' }, select: { appealDeadline: true } }))?.appealDeadline);
      const call = await world.dial(office);
      if (!call) return noCall();
      const res = await world.endCall(call, { transcript: PHRASES.deniedWithRef });
      const o = await observe(call, res.status);
      const evidence = `${fmt(o)} appealDeadline before call=${preset} after call=${o.appealDeadline}`;
      if (!o.appealDeadline) return fail('S', evidence, 'Two problems. The call has no appeal deadline captured. And the transcript says the claim was denied, yet the claim is stored as resolved or approved: "reference number is" is a resolution pattern that is checked before the denial patterns, so a denial that includes a reference number is classified RESOLVED, and the spoken reference lets it past the financial gate.');
      return preset
        ? finding('S', evidence, 'The claim has an appeal deadline, but it was already set before the call, so the call did not capture it.')
        : pass('S', evidence, 'The call captured an appeal deadline.');
    },

    P018: async () => {
      const order: Array<{ code: string; phrase: string }> = [
        { code: 'paid', phrase: 'payment issued' },
        { code: 'processing', phrase: 'still processing' },
        { code: 'resubmit_required', phrase: 'please resubmit' },
        { code: 'xray_required', phrase: 'send the x-ray' },
        { code: 'docs_required', phrase: 'clinical notes' },
        { code: 'coverage_maxed', phrase: 'maximum benefit' },
        { code: 'not_covered', phrase: 'not covered' },
        { code: 'appeal_required', phrase: 'appeal' },
      ];
      const wrong: string[] = [];
      for (let i = 0; i < order.length - 1; i += 1) {
        const hi = order[i];
        const lo = order[i + 1];
        if (!hi || !lo) continue;
        const o = classifyOutcome({ type: 'call.ended', call: { id: 'syn-ladder', status: 'ended', durationSeconds: 120 }, transcript: `${lo.phrase}. ${hi.phrase}.` });
        if (!o.outcomeDetail.includes(`legacy: ${hi.code}`)) wrong.push(`${hi.code}>${lo.code}`);
      }
      const block = classifyOutcome({ type: 'call.ended', call: { id: 'syn-ladder', status: 'ended', durationSeconds: 120 }, transcript: `payment issued. ${PHRASES.blockAutomated}` });
      const evidence = `adjacent pairs out of order ${wrong.length} of ${order.length - 1}; block wording beats paid wording ${block.outcome === 'BLOCK_DETECTED'}`;
      return verdict(wrong.length === 0 && block.outcome === 'BLOCK_DETECTED', 'U', evidence, 'The keyword ladder resolves mixed wording in the order its code documents, and a block phrase outranks everything. This checks the order is applied as written, not that the order is the right business order: paid wording outranks denial wording in the same call (see P014).');
    },

    P025: async () => {
      const cases: Array<{ label: string; transcript: string }> = [
        { label: 'paid with reference', transcript: PHRASES.paidWithRef },
        { label: 'paid without reference', transcript: PHRASES.paidNoRef },
        { label: 'still in process', transcript: PHRASES.pending },
      ];
      const parts: string[] = [];
      let allMatch = true;
      for (const c of cases) {
        const r = await oneCall(`P025 ${c.label}`, 45, { transcript: c.transcript });
        if (!r) return noCall();
        const predicted = predictClaimStatus(c.transcript);
        const match = r.obs.claimStatus === predicted;
        allMatch = allMatch && match;
        parts.push(`${c.label}: stored=${r.obs.claimStatus} predicted=${predicted}`);
      }
      return verdict(allMatch, 'S', parts.join(' | '), 'The claim status stored after the whole webhook pipeline equals what the outcome code and the financial gate predict, for a paid, an uncorroborated paid and a pending call.');
    },

    P026: async () => {
      const office = await world.makeOffice({ label: 'P026 desk broadcast' });
      await world.importRows(office.id, [{ tag: 'P026', opts: { days: 45 } }]);
      const call = await world.dial(office);
      if (!call) return noCall();
      const types = await world.collectDeskEvents(office, async () => {
        await world.endCall(call, { transcript: PHRASES.paidWithRef });
      });
      const set = Array.from(new Set(types)).sort();
      return verdict(types.includes('call.ended'), 'S', `desk socket event types ${set.join(',')}`, 'A front desk socket for the practice receives call.ended when the call finishes. Rendering in a browser is not exercised.');
    },

    P027: async () => {
      const office = await world.makeOffice({ label: 'P027 audit log' });
      const [claimId] = await world.importRows(office.id, [{ tag: 'P027', opts: { days: 45 } }]);
      const seen: string[] = [];
      const original = logger.audit.bind(logger);
      logger.audit = (event: string, fields?: Record<string, unknown>): void => {
        seen.push(event);
        original(event, fields);
      };
      try {
        const call = await world.dial(office);
        if (!call) return noCall();
      } finally {
        logger.audit = original;
      }
      const rows = await plain.phiAccessEvent.count({ where: { practiceId: office.id, recordId: claimId ?? '' } });
      return verdict(seen.includes('PHI_TOKEN_RESOLVED') && rows >= 1, 'S', `audit log events seen ${Array.from(new Set(seen)).join(',') || 'none'}; PHI access rows for the claim ${rows}`, 'Dispatch logs PHI_TOKEN_RESOLVED and writes a PHI access event for the claim. No identifier is in either; teardown sweeps the database for them.');
    },

    P028: async () => {
      const office = await world.makeOffice({ label: 'P028 guardrail outbox' });
      await world.importRows(office.id, [{ tag: 'P028', opts: { days: 45 } }]);
      const call = await world.dial(office);
      if (!call) return noCall();
      await world.endCall(call, { transcript: PHRASES.paidWithRef });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const rows = await plain.guardrailAuditOutbox.count({ where: { callAttemptId: call.attemptId } });
      return verdict(rows === 1, 'S', `guardrail audit outbox rows for the attempt ${rows}`, 'The end of a call queues exactly one guardrail audit job for later, without blocking the webhook. The sidecar that runs the audit is not exercised.');
    },

    P029: async () => {
      const csv = await oneCall('P029 csv first', 45, { transcript: PHRASES.paidWithRef });
      const writeback = await world.makeOffice({ label: 'P029 pms writeback' });
      await plain.practice.update({ where: { id: writeback.id }, data: { recoveryMode: 'PMS_WRITEBACK' } });
      await world.importRows(writeback.id, [{ tag: 'P029W', opts: { days: 45 } }]);
      const call = await world.dial(writeback);
      if (!csv || !call) return noCall();
      await world.endCall(call, { transcript: PHRASES.paidWithRef });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const csvRows = await plain.emrSyncOutbox.count({ where: { claimId: csv.call.claimId } });
      const wbRows = await plain.emrSyncOutbox.count({ where: { claimId: call.claimId } });
      return verdict(csvRows === 0 && wbRows >= 1, 'S', `claim status csv-first=${csv.obs.claimStatus} outbox rows csv-first ${csvRows}; claim status writeback=${(await observe(call, 200)).claimStatus} outbox rows writeback ${wbRows}`, 'A resolved claim queues an EMR sync event only for a practice in PMS writeback mode, and none for a CSV-first practice.');
    },

    P030: async () => {
      const office = await world.makeOffice({ label: 'P030 kpi' });
      const claims = await world.importRows(office.id, [
        { tag: 'P030A', opts: { days: 45 } },
        { tag: 'P030B', opts: { days: 45 } },
        { tag: 'P030C', opts: { days: 45 } },
      ]);
      const now = new Date();
      const variants: Array<{ repName: string | null; referenceNumber: string | null }> = [
        { repName: 'Synthetic Rep', referenceNumber: null },
        { repName: null, referenceNumber: 'SYNREF0001' },
        { repName: null, referenceNumber: null },
      ];
      for (let i = 0; i < variants.length; i += 1) {
        const v = variants[i];
        await plain.callAttempt.create({
          data: {
            claimId: claims[i] ?? '',
            vapiCallId: `syn-kpi-${office.id.slice(0, 8)}-${i}`,
            initiatedAt: now,
            completedAt: now,
            outcome: 'RESOLVED',
            outcomeDetail: 'Synthetic resolved call',
            repName: v?.repName ?? null,
            referenceNumber: v?.referenceNumber ?? null,
          },
        });
      }
      const k = await getPhase5CallKpis(plain, office.id, new Date(now.getTime() - 60_000));
      return verdict(k.authenticationSuccessRate === 66.7 && k.totalCalls === 3, 'S', `totalCalls=${k.totalCalls} authenticationSuccessRate=${k.authenticationSuccessRate}`, 'The authentication KPI counts a call as authenticated when it has a rep name or a reference number: 2 of 3 gives 66.7.');
    },
  };
}
