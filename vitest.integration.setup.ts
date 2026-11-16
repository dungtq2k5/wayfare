import { afterEach, expect } from 'vitest';

// A `pg` deprecation fails the spec it appeared in, so the next transaction that runs two queries
// at once is fixed when it is written, not read about months later (conventions §8). `pg` prints
// it once per process: it is the first occurrence that fails.
const deprecations: string[] = [];
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('client.query()')) {
    deprecations.push(warning.message);
  }
});

afterEach(async () => {
  // Node emits a warning on the next tick, after the query that caused it.
  await new Promise((resolve) => setImmediate(resolve));
  const [first] = deprecations.splice(0);
  if (first !== undefined) {
    expect.fail(`pg deprecation during "${expect.getState().currentTestName}": ${first}`);
  }
});
