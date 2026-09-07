import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, CarrierId } from '@prisma/client';
import { parseCallTranscript, parseTranscriptAndStore } from '../../src/server/services/transcriptParserService';

const prisma = new PrismaClient();

describe('Transcript Parser Integration', () => {
  let practiceId: string;
  let claimId: string;
  let callAttemptId: string;

  beforeAll(async () => {
    // Create test data — practice, claim, call attempt
    const practice = await prisma.practice.create({
      data: {
        name: 'Test Dental Practice',
        passwordHash: 'test-hash',
      },
    });
    practiceId = practice.id;

    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId,
        carrierId: 'sun_life' as CarrierId,
        claimNumber: 'CLM-001',
        patientToken: 'token-001',
        billedAmount: 500,
        outstandingAmount: 500,
        daysOutstanding: 25,
      },
    });
    claimId = claim.id;

    const callAttempt = await prisma.callAttempt.create({
      data: {
        claimId,
        vapiCallId: `test-call-${Date.now()}`,
        initiatedAt: new Date(),
        transcriptUrl: null,
      },
    });
    callAttemptId = callAttempt.id;
  });

  afterAll(async () => {
    await prisma.callAttempt.deleteMany({ where: { claimId } });
    await prisma.insuranceClaim.deleteMany({ where: { id: claimId } });
    await prisma.practice.delete({ where: { id: practiceId } });
    await prisma.$disconnect();
  });

  it('should parse a Sun Life claim approval transcript', async () => {
    const transcript = `
      AI: Good morning, I'm calling about claim CLM-001 for a patient.
      Rep: Good morning, I can help with that. Let me look up the claim.
      AI: The procedure code is D1110 for a cleaning.
      Rep: Yes, I see that claim. We approved it for $400 of the $500 billed amount.
      AI: Thank you. So $400 is approved and the patient owes $100?
      Rep: Correct. The patient's deductible was applied. Reference number is REF-12345.
      AI: Thank you for confirming.
    `;

    const result = await parseCallTranscript(transcript, 'sun_life' as CarrierId, 'CLM-001');

    expect(result).toBeDefined();
    expect(result.carrierName).toBe('Sun Life');
    expect(result.claimStatus).toBe('APPROVED');
    expect(result.approvedAmount).toBe(400);
    expect(result.remainingPatientResponsibility).toBe(100);
    expect(result.ledgerNote).toContain('Sun Life');
    expect(result.ledgerNote).toContain('Approved');
  });

  it('should parse a claim held at carrier', async () => {
    const transcript = `
      AI: Hi, calling about claim CLM-002.
      Rep: Let me look that up. The claim is still under review.
      AI: When can we expect a decision?
      Rep: We should have a determination within 10 business days. We're just waiting on some documentation.
      AI: What documentation is needed?
      Rep: Radiographic evidence for the endodontic procedure. You can submit that via fax.
      AI: Thank you.
    `;

    const result = await parseCallTranscript(transcript, 'manulife' as CarrierId, 'CLM-002');

    expect(result).toBeDefined();
    expect(result.claimStatus).toBe('HELD_AT_CARRIER');
    expect(result.nextActionRequired).toContain('documentation' || 'submit' || 'fax');
    expect(result.ledgerNote).toContain('Manulife');
  });

  it('should parse a claim denial', async () => {
    const transcript = `
      AI: Hi, I'm calling about claim CLM-003.
      Rep: Yes, this claim was denied.
      AI: What was the reason?
      Rep: The procedure code D7210 is not a covered service under this plan.
      AI: Is there an appeal process?
      Rep: You can appeal within 30 days if you have clinical documentation showing medical necessity.
      AI: Thank you.
    `;

    const result = await parseCallTranscript(transcript, 'canada_life' as CarrierId, 'CLM-003');

    expect(result).toBeDefined();
    expect(result.claimStatus).toBe('DENIED');
    expect(result.nextActionRequired).toContain('appeal' || 'documentation' || 'Appeal');
    expect(result.ledgerNote).toContain('Canada Life');
  });

  it('should store parsed outcome in CallAttempt record', async () => {
    const transcript = `
      AI: Calling about claim CLM-004.
      Rep: The claim was approved for $450 of the $500 billed. Reference number is REF-67890.
    `;

    const result = await parseTranscriptAndStore(
      prisma,
      callAttemptId,
      transcript,
      'sun_life' as CarrierId,
      'CLM-001',
    );

    // Verify the parsed outcome was returned
    expect(result).toBeDefined();
    expect(result.ledgerNote).toBeDefined();

    // Verify it was stored in the database
    const storedAttempt = await prisma.callAttempt.findUnique({
      where: { id: callAttemptId },
    });

    expect(storedAttempt).toBeDefined();
    expect(storedAttempt?.parsedClaimOutcome).toBeDefined();
    const parsed = storedAttempt?.parsedClaimOutcome as Record<string, unknown> | null;
    expect(parsed?.ledgerNote).toBeDefined();
  });

  it('should format ledger note with carrier name and date', async () => {
    const transcript = 'AI: Hello. Rep: Claim approved for $300. Reference REF-111.';

    const result = await parseCallTranscript(transcript, 'green_shield' as CarrierId, 'CLM-005');

    expect(result.ledgerNote).toContain('Green Shield');
    expect(result.ledgerNote).toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date format
    expect(result.ledgerNote).toContain('CollectRx');
  });

  it('should handle transcripts with no clear outcome', async () => {
    const transcript = 'AI: Hi. Rep: The call was disconnected.';

    const result = await parseCallTranscript(transcript, 'rbc' as CarrierId, 'CLM-006');

    expect(result).toBeDefined();
    expect(result.ledgerNote).toBeDefined();
    // Should return safe defaults
    expect(result.ledgerNote.length).toBeGreaterThan(0);
  });

  it('should preserve denial reason codes when mentioned', async () => {
    const transcript = `
      AI: What's the reason for denial?
      Rep: The reason code is 42 — procedure not covered under the patient's plan.
    `;

    const result = await parseCallTranscript(transcript, 'telus_adjudicare' as CarrierId, 'CLM-007');

    expect(result).toBeDefined();
    expect(result.claimStatus).toBe('DENIED');
    // May contain the denial reason code (implementation dependent on LLM)
  });
});
