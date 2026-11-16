import { describe, expect, it, vi } from 'vitest';

const listeners: (() => boolean)[] = [];
vi.mock('react-native', () => ({
  BackHandler: {
    addEventListener: (_event: string, listener: () => boolean) => {
      listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
    },
  },
}));

const { closeOnBack } = await import('./sheet-back');

/** Android's dispatch: the newest listener first; back goes on to the router when none consumes it. */
const pressBack = () => [...listeners].reverse().some((listener) => listener());

describe('closeOnBack', () => {
  it('closes the open sheet and consumes back, then lets back through once it is closed', () => {
    const onClose = vi.fn();
    const release = closeOnBack(onClose);
    expect(pressBack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    release();
    expect(pressBack()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
