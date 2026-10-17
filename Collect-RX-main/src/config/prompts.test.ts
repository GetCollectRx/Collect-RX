import { describe, it, expect } from 'vitest';
import { classifyIvrPrompt, buildVoicePrompt, INDUSTRY_PROMPTS, DISCLOSURE_EN, CANADIAN_CARRIER_CONTEXT } from './prompts';
import { INDUSTRY_TYPES } from '../types/industry-claims';

describe('classifyIvrPrompt', () => {
  it.each([
    ['For English, press 1. Pour le français, appuyez sur le 2.', 'language_select'],
    ['Pour le français, composez le 2', 'language_select'],
    ['If you are a service provider, press 3', 'provider_menu'],
    ['Si vous êtes un fournisseur, appuyez sur 3', 'provider_menu'],
    ['To check claim status press 1', 'claim_status_menu'],
    ['Pour vérifier le statut d\'une réclamation, appuyez sur 1', 'claim_status_menu'],
    ['Please enter your claim number followed by pound', 'enter_claim_number'],
    ['Veuillez saisir le numéro de réclamation', 'enter_claim_number'],
    ['Please stay on the line, your call is important to us', 'hold_notice'],
    ['Votre appel est important pour nous. Veuillez patienter.', 'hold_notice'],
    ['To speak to a representative, press 0', 'representative'],
    ['Pour parler à un représentant, appuyez sur 0', 'representative'],
    ['the weather is nice', 'unknown'],
  ])('%s -> %s', (text, intent) => {
    expect(classifyIvrPrompt(text).intent).toBe(intent);
  });
  it('reports language', () => {
    expect(classifyIvrPrompt('Pour parler à un représentant').language).toBe('fr');
    expect(classifyIvrPrompt('speak to a representative').language).toBe('en');
  });
});

describe('prompts', () => {
  it('has a prompt for every industry', () => {
    for (const i of INDUSTRY_TYPES) expect(INDUSTRY_PROMPTS[i]).toBeTruthy();
  });
  it('builds a prompt with disclosure, scope and carrier context', () => {
    const p = buildVoicePrompt({ industryType: 'AUTO_COLLISION', carrierKey: 'icbc', language: 'fr' });
    expect(p).toContain(DISCLOSURE_EN);
    expect(p).toContain('ICBC');
    expect(p).toContain('Start in: French');
    expect(p).toContain('Never negotiate');
  });
  it('contains no raw PHI-looking values or US-only constructs', () => {
    for (const i of INDUSTRY_TYPES) {
      const p = buildVoicePrompt({ industryType: i });
      expect(p).not.toMatch(/\b\d{3}-\d{3}-\d{4}\b/);
      expect(p).not.toMatch(/ERISA|Medicare|NPI/);
    }
  });
  it('covers every carrier the brief lists', () => {
    for (const k of ['intact','aviva','desjardins','icbc','sgi','mpi','cooperators','sun_life','canada_life','manulife','green_shield','cdcp','wsib','wcb','wawanesa'])
      expect(CANADIAN_CARRIER_CONTEXT[k]).toBeTruthy();
  });
});
