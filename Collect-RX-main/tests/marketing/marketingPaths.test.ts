import { describe, expect, it } from 'vitest';
import { marketingPageFromPathname } from '../../src/website/marketingPaths';

describe('marketingPageFromPathname', () => {
  it('maps marketing URLs to page ids', () => {
    expect(marketingPageFromPathname('/')).toBe('home');
    expect(marketingPageFromPathname('/landing')).toBe('home');
    expect(marketingPageFromPathname('/how-it-works')).toBe('how-it-works');
    expect(marketingPageFromPathname('/roi/')).toBe('roi');
    expect(marketingPageFromPathname('/features')).toBe('features');
    expect(marketingPageFromPathname('/carriers')).toBe('carriers');
    expect(marketingPageFromPathname('/compliance')).toBe('compliance');
  });

  it('falls back to home for unknown paths', () => {
    expect(marketingPageFromPathname('/unknown')).toBe('home');
  });
});
