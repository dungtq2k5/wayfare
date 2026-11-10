import { describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startTransition: (work: () => void) => work(),
}));
vi.mock('../ui/error-state', () => ({ WebErrorState: () => null }));

// The unit transform compiles JSX to `React.createElement`.
(globalThis as { React?: unknown }).React = await import('react');
const { default: PageError } = await import('./error');

describe('a page whose server read failed (F3)', () => {
  it('draws the error state, and *Try again* refreshes the server component before resetting', () => {
    const calls: string[] = [];
    router.refresh.mockImplementation(() => calls.push('refresh'));
    const page = PageError({ error: new Error('catalog down'), reset: () => calls.push('reset') });
    const state = (page.props as { children: { props: { error: unknown; onRetry: () => void } } })
      .children;
    // A server error reaches the boundary without a request id.
    expect(state.props.error).toBeNull();
    state.props.onRetry();
    expect(calls).toEqual(['refresh', 'reset']);
  });
});
