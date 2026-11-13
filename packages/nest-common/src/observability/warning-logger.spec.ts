import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installWarningLogger } from './warning-logger';
import type { WarningLoggerOptions } from './warning-logger';

interface Line {
  readonly level: 'info' | 'warn';
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

const KNOWN =
  'Possible EventEmitter memory leak detected. 11 error listeners added to [PassThrough]. MaxListeners is 10.';

describe('installWarningLogger', () => {
  let lines: Line[];
  let restore: () => void;
  // The worker's own `warning` listeners, put back after each test.
  let own: NodeJS.WarningListener[];

  const sink = {
    info: (fields: Record<string, unknown>, message: string) =>
      lines.push({ level: 'info', fields, message }),
    warn: (fields: Record<string, unknown>, message: string) =>
      lines.push({ level: 'warn', fields, message }),
  } as unknown as NonNullable<WarningLoggerOptions['logger']>;

  /** Installs with explicit inputs (nothing from the process), emits, and lets Node deliver. */
  async function run(
    options: Omit<WarningLoggerOptions, 'logger'>,
    emit: () => void,
  ): Promise<void> {
    restore = installWarningLogger({ logger: sink, execArgv: [], env: {}, ...options });
    emit();
    await new Promise((resolve) => setImmediate(resolve));
  }

  beforeEach(() => {
    lines = [];
    own = process.listeners('warning');
    restore = () => undefined;
  });

  afterEach(() => {
    restore();
    for (const fn of process.listeners('warning')) process.off('warning', fn);
    for (const fn of own) process.on('warning', fn);
  });

  it('logs a warning once at warn, with its name, code and message', async () => {
    await run({}, () =>
      process.emitWarning('about to break', { type: 'CustomWarning', code: 'W1' }),
    );
    expect(lines).toEqual([
      {
        level: 'warn',
        fields: { name: 'CustomWarning', code: 'W1' },
        message: 'about to break',
      },
    ]);
  });

  it('logs the known PassThrough warning once at info, naming its dependency, then drops it', async () => {
    await run({}, () => {
      for (let i = 0; i < 3; i += 1) {
        process.emitWarning(KNOWN, { type: 'MaxListenersExceededWarning' });
      }
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      fields: { name: 'MaxListenersExceededWarning', dependency: 'teeny-request@11.0.1' },
    });
  });

  it('still shows a different MaxListenersExceededWarning', async () => {
    await run({}, () =>
      process.emitWarning('11 close listeners added to [Socket].', {
        type: 'MaxListenersExceededWarning',
      }),
    );
    expect(lines.map((line) => line.level)).toEqual(['warn']);
  });

  it('logs nothing under --no-warnings, in the arguments or in NODE_OPTIONS, or NODE_NO_WARNINGS=1', async () => {
    for (const options of [
      { execArgv: ['--no-warnings'] },
      { nodeOptions: '--max-old-space-size=512 --no-warnings' },
      { env: { NODE_NO_WARNINGS: '1' } },
    ]) {
      await run(options, () => process.emitWarning('quiet please'));
      restore();
    }
    expect(lines).toEqual([]);
  });

  it('skips a deprecation under --no-deprecation, and only a deprecation', async () => {
    await run({ noDeprecation: true }, () => {
      process.emitWarning('old api', { type: 'DeprecationWarning', code: 'DEP9999' });
      process.emitWarning('other', { type: 'CustomWarning' });
    });
    expect(lines.map((line) => line.message)).toEqual(['other']);
  });

  it('skips what --disable-warning names, by name or by code, in either spelling, repeated', async () => {
    await run(
      {
        execArgv: ['--disable-warning=CustomWarning'],
        nodeOptions: '--disable-warning DEP0040 "--disable-warning=W2"',
      },
      () => {
        process.emitWarning('a', { type: 'CustomWarning' });
        process.emitWarning('b', { type: 'DeprecationWarning', code: 'DEP0040' });
        process.emitWarning('c', { type: 'OtherWarning', code: 'W2' });
        process.emitWarning('d', { type: 'OtherWarning', code: 'W3' });
      },
    );
    expect(lines.map((line) => line.message)).toEqual(['d']);
  });

  it('adds the stack under --trace-warnings, and for a deprecation under --trace-deprecation', async () => {
    await run({ execArgv: ['--trace-warnings'] }, () => process.emitWarning('with stack'));
    expect(lines[0]?.fields.stack).toEqual(expect.stringContaining('with stack'));

    lines = [];
    restore();
    await run({ traceDeprecation: true }, () => {
      process.emitWarning('dep', { type: 'DeprecationWarning', code: 'DEP1' });
      process.emitWarning('plain');
    });
    expect(lines[0]?.fields.stack).toBeDefined();
    expect(lines[1]?.fields.stack).toBeUndefined();
  });
});
