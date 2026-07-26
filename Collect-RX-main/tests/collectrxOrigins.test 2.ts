import { describe, expect, it } from 'vitest';
import {
  COLLECTRX_PROD_API_ORIGIN,
  COLLECTRX_PROD_APP_ORIGIN,
} from '../src/lib/collectrxOrigins';

describe('collectrxOrigins', () => {
  it('points production API at Fly', () => {
    expect(COLLECTRX_PROD_API_ORIGIN).toBe('https://collect-rx.fly.dev');
    expect(COLLECTRX_PROD_APP_ORIGIN).toBe('https://collect-rx.fly.dev');
  });
});
