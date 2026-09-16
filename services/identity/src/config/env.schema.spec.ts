import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.schema';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://wayfare:wayfare@localhost:5433/wayfare_identity',
  NATS_URL: 'nats://localhost:4222',
  GRPC_URL: '0.0.0.0:50051',
  OPS_PORT: '3101',
  METRICS_PORT: '9101',
};

describe('identity configuration', () => {
  it('parses a complete environment', () => {
    const config = loadConfig(valid);
    expect(config.OPS_PORT).toBe(3101);
    expect(config.isProduction).toBe(false);
  });

  it('refuses to boot with a missing variable, naming it', () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });
});
