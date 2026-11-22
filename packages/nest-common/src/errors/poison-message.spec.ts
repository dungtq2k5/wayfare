import { describe, expect, it } from 'vitest';
import { PoisonMessage, toErrorMessage } from './poison-message';

describe('toErrorMessage', () => {
  it('reads an Error’s message, a string as it is, and anything else as JSON or text', () => {
    expect(toErrorMessage(new PoisonMessage('references nothing'))).toBe('references nothing');
    expect(toErrorMessage('timeout')).toBe('timeout');
    expect(toErrorMessage({ code: 7 })).toBe('{"code":7}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toErrorMessage(circular)).toBe('[object Object]');
  });
});
