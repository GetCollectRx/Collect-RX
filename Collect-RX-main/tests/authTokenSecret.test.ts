import { afterEach, describe, expect, it } from 'vitest';
import { assertJwtConfigAtStartup, signPlatformDevToken } from '../src/server/authToken.js';

const original = process.env.JWT_SECRET;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('JWT signing secret', () => {
  it.each(['production', 'development', 'test'])(
    'refuses to sign or start without JWT_SECRET when NODE_ENV=%s',
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.JWT_SECRET;
      expect(() => assertJwtConfigAtStartup()).toThrow('JWT_SECRET is required');
      expect(() => signPlatformDevToken()).toThrow('JWT_SECRET is required');
    },
  );

  it('signs when JWT_SECRET is set', () => {
    process.env.JWT_SECRET = 'unit-test-placeholder-not-for-production';
    expect(signPlatformDevToken().split('.')).toHaveLength(3);
  });
});
