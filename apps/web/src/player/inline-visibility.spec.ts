// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '../testing/render-hook';
import { setInlineVisible, useInlineVisible } from './inline-visibility';

describe('the inline player on screen (WQ2)', () => {
  it('tells the mini player which Place’s inline player shows, and when it scrolls away', async () => {
    const rendered = await renderHook(() => useInlineVisible());
    expect(rendered.current()).toBeNull();
    act(() => setInlineVisible('p1'));
    expect(rendered.current()).toBe('p1');
    act(() => setInlineVisible(null));
    expect(rendered.current()).toBeNull();
    rendered.unmount();
  });
});
