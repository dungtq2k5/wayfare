// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '../testing/render-hook';

vi.mock('../env', () => ({ API_URL: 'http://localhost:13000/api/v1' }));

const { useNetworkStore } = await import('../network/network-store');
const { useSubmit } = await import('./use-form');

describe('a form’s submit (K4)', () => {
  beforeEach(() => useNetworkStore.setState({ status: 'online' }));

  it('runs one request at a time: a second tap while one runs does nothing', async () => {
    const rendered = await renderHook(() => useSubmit());
    let finish: () => void = () => undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = rendered.current().submit(run);
      await Promise.resolve();
    });
    expect(rendered.current().running).toBe(true);
    await act(() => rendered.current().submit(run));
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
    expect(rendered.current().running).toBe(false);
    await act(async () => {
      const second = rendered.current().submit(run);
      finish();
      await second;
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('frees the form when the request fails', async () => {
    const rendered = await renderHook(() => useSubmit());
    await act(() =>
      rendered
        .current()
        .submit(() => Promise.reject(new Error('400')))
        .catch(() => undefined),
    );
    expect(rendered.current().running).toBe(false);
  });

  it('sends nothing offline, keeping the fields', async () => {
    useNetworkStore.setState({ status: 'offline' });
    const rendered = await renderHook(() => useSubmit());
    const run = vi.fn(() => Promise.resolve());
    await act(() => rendered.current().submit(run));
    expect(rendered.current().offline).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});
