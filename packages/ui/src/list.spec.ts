// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataList } from './list';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The browser's size observer, fired by the test when the layout changes. */
const observers: (() => void)[] = [];
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe() {}
    disconnect() {}
  },
);

/** The table's box at a width, its content at another. */
function lay(contentWidth: number, boxWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(contentWidth);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(boxWidth);
}

let root: Root | null = null;
function draw() {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() =>
    root!.render(
      createElement(DataList<{ id: string }>, {
        caption: 'Map packs',
        columns: [{ key: 'id', label: 'Pack' }],
        rows: [{ id: 'v1' }],
        rowKey: (row) => row.id,
        cell: (row) => row.id,
        card: (row) => row.id,
        rowEnd: { label: 'Actions', render: () => createElement('button', {}, 'Publish') },
      }),
    ),
  );
}
const scroller = () => document.querySelector('[role="group"]');

describe('a list’s table wider than its box', () => {
  afterEach(() => {
    act(() => root?.unmount());
    vi.restoreAllMocks();
    observers.length = 0;
  });

  it('fits: no scrolling box and no tab stop', () => {
    lay(704, 704);
    draw();
    expect(scroller()).toBeNull();
    expect(document.querySelector('table')!.parentElement!.tabIndex).toBe(-1);
  });

  it('wider: a labelled group a keyboard reaches, which goes when the table fits again', () => {
    lay(900, 704);
    draw();
    expect(scroller()).toMatchObject({ tabIndex: 0 });
    expect(scroller()!.getAttribute('aria-label')).toBe('Map packs');
    expect(scroller()!.contains(document.querySelector('table'))).toBe(true);
    // The phone's cards are never inside it.
    expect(scroller()!.contains(document.querySelector('ul'))).toBe(false);

    lay(704, 1100);
    act(() => observers.forEach((measure) => measure()));
    expect(scroller()).toBeNull();
  });
});
