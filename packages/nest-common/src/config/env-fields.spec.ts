import { describe, expect, it } from 'vitest';
import { zLogLevel, zNodeEnv, zPort } from './env-fields';

describe('shared env fields', () => {
  it('requires NODE_ENV and refuses an unknown mode', () => {
    expect(zNodeEnv.safeParse(undefined).success).toBe(false);
    expect(zNodeEnv.safeParse('staging').success).toBe(false);
    expect(zNodeEnv.parse('production')).toBe('production');
  });

  it('defaults LOG_LEVEL to info', () => {
    expect(zLogLevel.parse(undefined)).toBe('info');
    expect(zLogLevel.safeParse('verbose').success).toBe(false);
  });

  it('coerces a port string and refuses values outside 1..65535', () => {
    expect(zPort.parse('3000')).toBe(3000);
    expect(zPort.safeParse('0').success).toBe(false);
    expect(zPort.safeParse('65536').success).toBe(false);
    expect(zPort.safeParse('80.5').success).toBe(false);
  });
});
