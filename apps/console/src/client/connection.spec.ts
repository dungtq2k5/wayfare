// @vitest-environment happy-dom
import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@wayfare/ui/testing';
import { noteOutcome, useConnection } from './connection';

const online = (value: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
const failed = (code: string) => new ApiError(0, code, 'x');

describe('the connection banner (K14)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => noteOutcome(null));
  });

  it('is fine until a request goes unanswered, and fine again once one answers', async () => {
    online(true);
    const rendered = await renderHook(() => useConnection());
    expect(rendered.current()).toBe('fine');
    act(() => noteOutcome(failed(NETWORK_ERROR_CODE)));
    expect(rendered.current()).toBe('down');
    act(() => noteOutcome(failed(NETWORK_ERROR_CODE)));
    expect(rendered.current()).toBe('down');
    act(() => noteOutcome(null));
    expect(rendered.current()).toBe('fine');
    rendered.unmount();
  });

  it('counts the gateway’s own 503 as down, any other refusal as an answer', async () => {
    online(true);
    const rendered = await renderHook(() => useConnection());
    act(() => noteOutcome(failed('UPSTREAM_UNAVAILABLE')));
    expect(rendered.current()).toBe('down');
    act(() => noteOutcome(failed('EMAIL_TAKEN')));
    expect(rendered.current()).toBe('fine');
  });

  it('says offline before anything else, and never blames the API for it', async () => {
    const onLine = online(false);
    const rendered = await renderHook(() => useConnection());
    act(() => noteOutcome(failed(NETWORK_ERROR_CODE)));
    expect(rendered.current()).toBe('offline');
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(rendered.current()).toBe('fine');
  });
});
