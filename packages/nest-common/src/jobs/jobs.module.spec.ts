import { describe, expect, it } from 'vitest';
import { bullConnection } from './jobs.module';

describe('bullConnection', () => {
  it('reads a plain URL', () => {
    expect(bullConnection('redis://localhost:16379', 'svc')).toEqual({
      host: 'localhost',
      port: 16379,
      db: 0,
      connectionName: 'svc',
      maxRetriesPerRequest: null,
    });
  });

  it('reads credentials, a database and TLS', () => {
    expect(bullConnection('rediss://user:p%40ss@cache.internal/2', 'svc')).toEqual({
      host: 'cache.internal',
      port: 6379,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: {},
      connectionName: 'svc',
      maxRetriesPerRequest: null,
    });
  });
});
