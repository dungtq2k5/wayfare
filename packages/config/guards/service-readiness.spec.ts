// Guard: a backend service initialises before it opens gRPC (architecture §12). Nest runs the
// app's `onModuleInit` hooks — the database connection, the schema check, each peer client — in
// `init()`, which `listen()` would call only after `startAllMicroservices()` had opened the port.
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile } from './support/repo';

describe('service readiness', () => {
  it('opens gRPC only after the app has initialised, in every backend service', () => {
    const mains = listFiles('services/*/src/main.ts');
    expect(mains.length).toBeGreaterThan(0);
    const late = mains.filter((file) => {
      const source = readRepoFile(file);
      const grpc = source.indexOf('startAllMicroservices()');
      if (grpc === -1) return false;
      const init = source.indexOf('await app.init()');
      return init === -1 || init > grpc;
    });
    expect(late).toEqual([]);
  });
});
