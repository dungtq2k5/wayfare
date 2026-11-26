// @vitest-environment happy-dom
import { duration } from '@wayfare/design-tokens/tokens';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { nativeFake } from '../testing/react-native';
import { renderHook, settle } from '@wayfare/ui/testing';
import { useDuration } from './use-duration';

describe('an animation’s length (conventions §12.5)', () => {
  it('is the token’s, and none while the system removes animations', async () => {
    const token = Object.keys(duration)[0] as keyof typeof duration;
    const rendered = await renderHook(() => useDuration(token));
    await settle();
    expect(rendered.current()).toBeGreaterThan(0);
    act(() => nativeFake.reduceMotion.emit(true));
    expect(rendered.current()).toBe(0);
    rendered.unmount();
    expect(nativeFake.reduceMotion.size()).toBe(0);
  });
});
