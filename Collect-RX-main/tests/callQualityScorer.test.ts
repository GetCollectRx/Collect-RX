/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Call Quality Scorer Tests
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PrismaClient as PC } from '@prisma/client';
import { scoreCallQuality, scoreSingleCarrier } from '../src/server/services/callQualityScorer.js';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = new PC();
  // Clean up: remove any test data
  await prisma.callAttempt.deleteMany({});
  await prisma.insuranceClaim.deleteMany({});
  await prisma.practice.deleteMany({});
});

describe('Call Quality Scorer', () => {
  describe('scoreCallQuality', () => {
    it('returns empty metrics for practice with no calls', async () => {
      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
      });

      expect(report.totalCalls).toBe(0);
      expect(report.successfulCalls).toBe(0);
      expect(report.overallSuccessRate).toBe(0);
      expect(report.overallQualityScore).toBe(0);
    });

    it('calculates success rate correctly (RESOLVED outcomes)', async () => {
      const practice = await prisma.practice.create({
        data: {
          name: 'Test Practice',
          passwordHash: 'hash',
        },
      });

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'TEST123',
          patientToken: 'token123',
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 45,
        },
      });

      // Create 10 calls: 7 RESOLVED, 2 DENIED, 1 ESCALATED
      const now = new Date();
      for (let i = 0; i < 7; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-resolved-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 180,
            minutesBilled: 3,
            outcome: 'RESOLVED',
          },
        });
      }

      for (let i = 0; i < 2; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-denied-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 120,
            minutesBilled: 2,
            outcome: 'DENIED',
          },
        });
      }

      await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId: 'call-escalated-0',
          initiatedAt: now,
          completedAt: new Date(now.getTime() + 60000),
          durationSeconds: 150,
          minutesBilled: 3,
          outcome: 'ESCALATED',
        },
      });

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
        practiceId: practice.id,
      });

      expect(report.totalCalls).toBe(10);
      expect(report.successfulCalls).toBe(7);
      expect(report.overallSuccessRate).toBe(70);
      expect(report.failedCalls).toBe(0);
    });

    it('identifies outcome distribution correctly', async () => {
      const practice = await prisma.practice.create({
        data: { name: 'Test Practice', passwordHash: 'hash' },
      });

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'TEST456',
          patientToken: 'token456',
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 20,
        },
      });

      const now = new Date();
      const outcomes = [
        'RESOLVED',
        'APPROVED_PENDING_PAYMENT',
        'DENIED',
        'ESCALATED',
        'FAILED',
        'NO_ANSWER',
      ];

      for (const outcome of outcomes) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-${outcome}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 150,
            minutesBilled: 3,
            outcome: outcome as any,
          },
        });
      }

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
        practiceId: practice.id,
      });

      expect(report.outcomeDistribution.resolved).toBe(1);
      expect(report.outcomeDistribution.approved).toBe(1);
      expect(report.outcomeDistribution.denied).toBe(1);
      expect(report.outcomeDistribution.escalated).toBe(1);
      expect(report.outcomeDistribution.failed).toBe(1);
      expect(report.outcomeDistribution.noAnswer).toBe(1);
    });

    it('calculates carrier metrics correctly', async () => {
      const practice = await prisma.practice.create({
        data: { name: 'Test Practice', passwordHash: 'hash' },
      });

      const now = new Date();

      // Create calls for 2 carriers
      for (let carrier of ['sun_life', 'canada_life']) {
        const claim = await prisma.insuranceClaim.create({
          data: {
            practiceId: practice.id,
            carrierId: carrier as any,
            claimNumber: `TEST-${carrier}`,
            patientToken: `token-${carrier}`,
            billedAmount: 500,
            outstandingAmount: 500,
            daysOutstanding: 30,
          },
        });

        // Sun Life: 8 resolved out of 10
        // Canada Life: 4 resolved out of 10
        const resolvedCount = carrier === 'sun_life' ? 8 : 4;

        for (let i = 0; i < 10; i++) {
          const isResolved = i < resolvedCount;
          await prisma.callAttempt.create({
            data: {
              claimId: claim.id,
              vapiCallId: `call-${carrier}-${i}`,
              initiatedAt: now,
              completedAt: new Date(now.getTime() + 60000),
              durationSeconds: 150 + (i % 50), // Vary duration slightly
              minutesBilled: 3,
              outcome: isResolved ? 'RESOLVED' : 'FAILED',
            },
          });
        }
      }

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
        practiceId: practice.id,
      });

      const sunLife = report.carrierMetrics.find((c) => c.carrierId === 'sun_life');
      const canadaLife = report.carrierMetrics.find((c) => c.carrierId === 'canada_life');

      expect(sunLife?.successRate).toBe(80);
      expect(sunLife?.totalCalls).toBe(10);
      expect(canadaLife?.successRate).toBe(40);
      expect(canadaLife?.totalCalls).toBe(10);

      // Verify sorting by success rate (sun_life should be first)
      expect(report.carrierMetrics[0].carrierId).toBe('sun_life');
    });

    it('calculates agent performance correctly', async () => {
      const practice = await prisma.practice.create({
        data: { name: 'Test Practice', passwordHash: 'hash' },
      });

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'TEST789',
          patientToken: 'token789',
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 25,
        },
      });

      const now = new Date();

      // Claims_Agent: 8 resolved out of 10
      for (let i = 0; i < 8; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-claims-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 180,
            minutesBilled: 3,
            outcome: 'RESOLVED',
            activeAgent: 'Claims_Agent',
          },
        });
      }

      for (let i = 0; i < 2; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-claims-failed-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 60,
            minutesBilled: 1,
            outcome: 'FAILED',
            activeAgent: 'Claims_Agent',
          },
        });
      }

      // Escalation_Closer: 5 resolved out of 5
      for (let i = 0; i < 5; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-escalation-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 220,
            minutesBilled: 4,
            outcome: 'RESOLVED',
            activeAgent: 'Escalation_Closer',
          },
        });
      }

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
        practiceId: practice.id,
      });

      const claimsAgent = report.agentPerformance.find((a) => a.agentName === 'Claims_Agent');
      const escalationAgent = report.agentPerformance.find((a) => a.agentName === 'Escalation_Closer');

      expect(claimsAgent?.successRate).toBe(80);
      expect(claimsAgent?.totalCalls).toBe(10);
      expect(escalationAgent?.successRate).toBe(100);
      expect(escalationAgent?.totalCalls).toBe(5);

      // Verify sorting by success rate (Escalation_Closer should be first)
      expect(report.agentPerformance[0].agentName).toBe('Escalation_Closer');
    });

    it('calculates quality score and trends', async () => {
      const practice = await prisma.practice.create({
        data: { name: 'Test Practice', passwordHash: 'hash' },
      });

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'TEST999',
          patientToken: 'token999',
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 30,
        },
      });

      const now = new Date();
      // Create calls with 70% success rate
      for (let i = 0; i < 7; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-score-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 150 + (i * 10), // Normal duration
            minutesBilled: 3,
            outcome: 'RESOLVED',
          },
        });
      }

      for (let i = 0; i < 3; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-score-fail-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 100,
            minutesBilled: 2,
            outcome: 'FAILED',
          },
        });
      }

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
        practiceId: practice.id,
      });

      // Quality score should be > 50 for 70% success rate with good duration
      expect(report.overallQualityScore).toBeGreaterThan(50);
      expect(report.overallSuccessRate).toBe(70);

      // Trend should be calculated (default is stable for < 2 weeks)
      expect(report.trend).toBeDefined();
    });

    it('generates escalation recommendations for poor performers', async () => {
      const practice = await prisma.practice.create({
        data: { name: 'Test Practice', passwordHash: 'hash' },
      });

      // Create a claim with very low success rate (20%)
      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'TESTESC',
          patientToken: 'tokenesc',
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 30,
        },
      });

      const now = new Date();
      // 2 successful, 8 failed out of 10
      for (let i = 0; i < 2; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-esc-ok-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 150,
            minutesBilled: 3,
            outcome: 'RESOLVED',
          },
        });
      }

      for (let i = 0; i < 8; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-esc-fail-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 100,
            minutesBilled: 2,
            outcome: 'FAILED',
          },
        });
      }

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
        practiceId: practice.id,
      });

      // Should have carrier escalation for poor performance
      const carrierEscalation = report.escalationRecommendations.find(
        (r) => r.type === 'carrier' && r.subject.includes('Sun Life'),
      );
      expect(carrierEscalation).toBeDefined();
      expect(carrierEscalation?.severity).toBe('critical');
    });

    it('identifies outliers', async () => {
      const practice = await prisma.practice.create({
        data: { name: 'Test Practice', passwordHash: 'hash' },
      });

      // Create claims for 2 carriers with different performance
      for (let carrier of ['sun_life', 'canada_life']) {
        const claim = await prisma.insuranceClaim.create({
          data: {
            practiceId: practice.id,
            carrierId: carrier as any,
            claimNumber: `TEST-${carrier}`,
            patientToken: `token-${carrier}`,
            billedAmount: 500,
            outstandingAmount: 500,
            daysOutstanding: 30,
          },
        });

        const now = new Date();
        const resolvedCount = carrier === 'sun_life' ? 15 : 2; // Sun Life performs well, Canada Life poorly
        const totalCalls = 20;

        for (let i = 0; i < totalCalls; i++) {
          const isResolved = i < resolvedCount;
          await prisma.callAttempt.create({
            data: {
              claimId: claim.id,
              vapiCallId: `call-outlier-${carrier}-${i}`,
              initiatedAt: now,
              completedAt: new Date(now.getTime() + 60000),
              durationSeconds: 150,
              minutesBilled: 3,
              outcome: isResolved ? 'RESOLVED' : 'FAILED',
            },
          });
        }
      }

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const report = await scoreCallQuality(prisma, {
        since,
        to,
        practiceId: practice.id,
      });

      // Canada Life should be identified as a low performer
      expect(report.outliers.lowPerformingCarriers.length).toBeGreaterThan(0);
      expect(report.outliers.lowPerformingCarriers.some((c) => c.includes('Canada Life'))).toBe(true);
    });
  });

  describe('scoreSingleCarrier', () => {
    it('returns carrier metrics for specific carrier', async () => {
      const practice = await prisma.practice.create({
        data: { name: 'Test Practice', passwordHash: 'hash' },
      });

      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'TESTSL',
          patientToken: 'tokensl',
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 30,
        },
      });

      const now = new Date();
      for (let i = 0; i < 6; i++) {
        await prisma.callAttempt.create({
          data: {
            claimId: claim.id,
            vapiCallId: `call-sl-${i}`,
            initiatedAt: now,
            completedAt: new Date(now.getTime() + 60000),
            durationSeconds: 150 + (i * 10),
            minutesBilled: 3,
            outcome: i < 5 ? 'RESOLVED' : 'FAILED',
          },
        });
      }

      const to = new Date();
      const since = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const metrics = await scoreSingleCarrier(prisma, 'sun_life', {
        since,
        to,
        practiceId: practice.id,
      });

      expect(metrics.carrierId).toBe('sun_life');
      expect(metrics.totalCalls).toBe(6);
      expect(metrics.successRate).toBe(83); // 5 out of 6 = 83%
      expect(metrics.avgDurationSeconds).toBeGreaterThan(150);
    });
  });
});
