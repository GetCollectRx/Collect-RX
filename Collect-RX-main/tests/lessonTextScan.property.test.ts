import { describe, expect, it } from 'vitest';
import { scanLessonText } from '../src/server/learning/lessonTextScan.js';

/** Deterministic PRNG (mulberry32) so every generated case is reproducible from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

// Synthetic names only. None of these pairs is in the scan allowlist.
const FIRST_NAMES = ['Jordan', 'Priya', 'Mateo', 'Hannah', 'Kwame', 'Ingrid', 'Tomasz', 'Leila', 'Daniel', 'Yara'];
const LAST_NAMES = ['Alvarez', 'Chandra', 'Okafor', 'Lindqvist', 'Marchetti', 'Haddad', 'Brennan', 'Nakamura'];
const TEMPLATES = [
  'The rep {name} asks for the provider number first.',
  'Always confirm the claim with {name} before transferring.',
  'Note that {name} requires the group number on hold.',
];

describe('lesson text scan: seeded property tests', () => {
  for (const seed of [1, 42, 20261013]) {
    it(`rejects every seeded person-name lesson (seed ${seed})`, () => {
      const rand = prng(seed);
      for (let i = 0; i < 200; i += 1) {
        const name = `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;
        const text = pick(rand, TEMPLATES).replace('{name}', name);
        const result = scanLessonText(text, []);
        expect(result.ok, `case ${i} seed ${seed}`).toBe(false);
        if (!result.ok) expect(result.reasonCode).toBe('PERSON_NAME_PATTERN');
      }
    });

    it(`rejects every seeded number run (seed ${seed})`, () => {
      const rand = prng(seed);
      for (let i = 0; i < 200; i += 1) {
        const length = 6 + Math.floor(rand() * 10);
        let digits = '';
        for (let d = 0; d < length; d += 1) digits += Math.floor(rand() * 10).toString();
        const result = scanLessonText(`Reference ${digits} is needed for the rep.`, []);
        expect(result.ok, `case ${i} seed ${seed} digits ${length}`).toBe(false);
      }
    });

    it(`rejects every seeded phone, date and email shape (seed ${seed})`, () => {
      const rand = prng(seed);
      const block = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');
      for (let i = 0; i < 100; i += 1) {
        const phone = `${block(3)}-${block(3)}-${block(4)}`;
        const date = `20${block(2)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`;
        const email = `desk${block(2)}@example.test`;
        expect(scanLessonText(`Call ${phone} for status.`, []).ok).toBe(false);
        expect(scanLessonText(`Claims dated ${date} were lost.`, []).ok).toBe(false);
        expect(scanLessonText(`Send copies to ${email} only.`, []).ok).toBe(false);
      }
    });
  }

  it('rejects text containing the contributing practice name or identifiers (fingerprint)', () => {
    const terms = ['maple ridge dental', '4165550199'];
    expect(scanLessonText('Calls from Maple Ridge Dental route to the provider line.', terms)).toEqual({
      ok: false,
      reasonCode: 'PRACTICE_FINGERPRINT',
    });
    expect(scanLessonText('The practice number (416) 555-0199 appears in the greeting.', terms)).toEqual({
      ok: false,
      reasonCode: 'PRACTICE_FINGERPRINT',
    });
  });

  it('accepts carrier-behaviour lessons with no identifiers', () => {
    const clean = [
      'This carrier asks for the provider number before discussing any claim.',
      'Option 2 on the IVR leads to the claim status queue during business hours.',
      'Sun Life reps confirm the reference number before giving a status.',
      'Hold music is followed by a verification prompt for the group number.',
    ];
    for (const text of clean) {
      expect(scanLessonText(text, ['maple ridge dental']), text).toEqual({ ok: true });
    }
  });

  it('never returns the matched text, only a reason code', () => {
    const result = scanLessonText('Ask Jordan Alvarez about the group.', []);
    expect(JSON.stringify(result)).not.toContain('Alvarez');
    expect(result).toEqual({ ok: false, reasonCode: 'PERSON_NAME_PATTERN' });
  });
});
