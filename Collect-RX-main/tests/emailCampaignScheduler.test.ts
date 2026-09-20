/**
 * Campaign scheduler tests — CASL sender identity is mandatory before anything sends.
 *
 * The scheduler previously fell back to a placeholder mailing address and phone number, so a
 * deploy that forgot the secrets would put a fabricated business address in front of every
 * recipient. These tests pin the refusal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runEmailCampaignScheduler } from '../src/server/marketing/emailCampaignScheduler.js';
import { renderEmailTemplate } from '../src/server/marketing/emailCampaignTemplates.js';

const PLACEHOLDER_ADDRESS = '123 Main St, Toronto, ON M5V 1B5';
const PLACEHOLDER_PHONE = '416-555-0100';

const REAL_ADDRESS = '250 Queen Street West, Suite 400, Toronto, ON M5V 2A1';
const REAL_PHONE = '647-555-0182';

function stubPrisma() {
  const findMany = vi.fn().mockResolvedValue([]);
  const update = vi.fn().mockResolvedValue({});
  const prisma = { prospect: { findMany, update } } as unknown as PrismaClient;
  return { prisma, findMany, update };
}

describe('runEmailCampaignScheduler — CASL sender identity', () => {
  const saved = { address: process.env.MAILING_ADDRESS, phone: process.env.SENDER_PHONE };

  beforeEach(() => {
    delete process.env.MAILING_ADDRESS;
    delete process.env.SENDER_PHONE;
  });

  afterEach(() => {
    if (saved.address === undefined) delete process.env.MAILING_ADDRESS;
    else process.env.MAILING_ADDRESS = saved.address;
    if (saved.phone === undefined) delete process.env.SENDER_PHONE;
    else process.env.SENDER_PHONE = saved.phone;
  });

  it('refuses to send, and never queries prospects, when both are unset', async () => {
    const { prisma, findMany } = stubPrisma();

    const result = await runEmailCampaignScheduler(prisma);

    expect(result.configError).toContain('MAILING_ADDRESS');
    expect(result.configError).toContain('SENDER_PHONE');
    expect(result.sent).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('names only the missing variable when one is set', async () => {
    process.env.SENDER_PHONE = REAL_PHONE;
    const { prisma } = stubPrisma();

    const result = await runEmailCampaignScheduler(prisma);

    expect(result.configError).toContain('MAILING_ADDRESS');
    expect(result.configError).not.toContain('SENDER_PHONE');
  });

  it('treats a whitespace-only address as unset', async () => {
    process.env.MAILING_ADDRESS = '   ';
    process.env.SENDER_PHONE = REAL_PHONE;
    const { prisma } = stubPrisma();

    const result = await runEmailCampaignScheduler(prisma);

    expect(result.configError).toContain('MAILING_ADDRESS');
    expect(result.sent).toBe(0);
  });

  it('proceeds to select recipients once both are configured', async () => {
    process.env.MAILING_ADDRESS = REAL_ADDRESS;
    process.env.SENDER_PHONE = REAL_PHONE;
    const { prisma, findMany } = stubPrisma();

    const result = await runEmailCampaignScheduler(prisma);

    expect(result.configError).toBeUndefined();
    expect(findMany).toHaveBeenCalledOnce();
    expect(result.errors).toEqual([]);
  });
});

describe('renderEmailTemplate — CASL footer contents', () => {
  const data = {
    ownerLastName: 'Nguyen',
    practiceName: 'Riverbend Dental',
    city: 'Toronto',
    bookingLink: 'https://collectrx.ca/demo',
    senderPhone: REAL_PHONE,
    mailingAddress: REAL_ADDRESS,
  };

  for (const type of ['initial', 'follow-up'] as const) {
    it(`${type}: carries the configured address and phone, not the placeholders`, () => {
      const email = renderEmailTemplate(type, data);

      for (const body of [email.html, email.text]) {
        expect(body).toContain(REAL_ADDRESS);
        expect(body).toContain(REAL_PHONE);
        expect(body).not.toContain(PLACEHOLDER_ADDRESS);
        expect(body).not.toContain(PLACEHOLDER_PHONE);
      }
    });

    it(`${type}: leaves no unsubstituted placeholders`, () => {
      const email = renderEmailTemplate(type, data);

      expect(email.subject).not.toMatch(/\{\{|\}\}/);
      expect(email.html).not.toMatch(/\{\{|\}\}/);
      expect(email.text).not.toMatch(/undefined|null/);
    });
  }

  it('initial: keeps an unsubscribe instruction in every subject variant', () => {
    // Subject variant is chosen at random per send; all three must carry the same footer.
    for (let i = 0; i < 25; i++) {
      const email = renderEmailTemplate('initial', data);
      expect(email.html.toLowerCase()).toContain('unsubscribe');
    }
  });
});
