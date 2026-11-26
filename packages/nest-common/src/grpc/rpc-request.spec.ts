import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { parseRpcRequest } from './rpc-request';

describe('parseRpcRequest (conventions §6.3)', () => {
  const schema = z.object({ page: z.object({ 'a/b~c': z.number() }) });

  it('returns the parsed request', () => {
    expect(parseRpcRequest(schema, { page: { 'a/b~c': 1 } })).toEqual({ page: { 'a/b~c': 1 } });
  });

  it('refuses an invalid one as VALIDATION_FAILED, each issue at its escaped JSON pointer', () => {
    try {
      parseRpcRequest(schema, { page: { 'a/b~c': 'x' } });
      expect.unreachable();
    } catch (error) {
      expect(JSON.stringify((error as { getError(): unknown }).getError())).toContain(
        '/page/a~1b~0c',
      );
    }
  });
});
