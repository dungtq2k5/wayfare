import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROTO_ROOT, protoPaths } from './proto';

describe('proto paths', () => {
  it('resolves every proto file from the installed contracts package', () => {
    for (const path of protoPaths('identity', 'health')) expect(existsSync(path), path).toBe(true);
    expect(PROTO_ROOT.endsWith('proto')).toBe(true);
  });
});
