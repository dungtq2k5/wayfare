// The web's `react-dom/client`, which the mobile specs render hooks with (vitest.config.mts): the
// app ships no `react-dom`, so its types are declared here, as far as render-hook.ts uses them.
declare module 'react-dom/client' {
  import type { ReactNode } from 'react';

  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }

  export function createRoot(container: Element): Root;
}
