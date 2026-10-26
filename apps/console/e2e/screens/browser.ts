// The browser the screens render in: Playwright's own server inside the official Playwright image,
// at exactly the lockfile's `@playwright/test` version. A screenshot is a function of the fonts and
// the renderer, so every baseline, on every machine and in CI, is drawn by this one image.
//
// The server runs from the repository's own node_modules, mounted read-only: nothing is downloaded
// into the container. The specs connect with `exposeNetwork: '<loopback>'`, so the browser reaches
// the console, the gateway and the media emulator on this machine's localhost through the client.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

export const BROWSER_PORT = 3940;
export const BROWSER_WS = `ws://127.0.0.1:${BROWSER_PORT}/`;
const CONTAINER = 'wayfare-screens-browser';

/** The console's own `@playwright/test` package directory, which pnpm links to its real path. */
function playwrightDir(): string {
  const require = createRequire(__filename);
  return dirname(require.resolve('@playwright/test/package.json'));
}

/** `mcr.microsoft.com/playwright:v<the installed version>-noble`. */
export function browserImage(): string {
  const { version } = JSON.parse(readFileSync(`${playwrightDir()}/package.json`, 'utf8')) as {
    version: string;
  };
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}

export async function startBrowserServer(): Promise<void> {
  stopBrowserServer();
  // pnpm keeps packages in its store under node_modules/.pnpm: mount the whole tree, so
  // @playwright/test finds playwright-core beside it.
  const modules = playwrightDir().split('/node_modules/')[0] + '/node_modules';
  const cli = playwrightDir().replace(modules, '/pw/node_modules') + '/cli.js';
  execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--init',
      '--name',
      CONTAINER,
      '--user',
      'pwuser',
      '--publish',
      `127.0.0.1:${BROWSER_PORT}:${BROWSER_PORT}`,
      '--volume',
      `${modules}:/pw/node_modules:ro`,
      browserImage(),
      'node',
      cli,
      'run-server',
      '--port',
      String(BROWSER_PORT),
      '--host',
      '0.0.0.0',
    ],
    { stdio: 'pipe' },
  );
  await waitForServer(120_000);
}

export function stopBrowserServer(): void {
  try {
    execFileSync('docker', ['rm', '--force', CONTAINER], { stdio: 'pipe' });
  } catch {
    // Not running: nothing to stop.
  }
}

/**
 * Waits for the server itself, not just the port: Docker's proxy accepts a connection before the
 * server inside listens, and the first spec's connection then hangs up. The server answers a plain
 * HTTP request once it's ready.
 */
async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await fetch(`http://127.0.0.1:${BROWSER_PORT}/`, {
      signal: AbortSignal.timeout(2_000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`The Playwright browser server never answered on ${BROWSER_PORT}`);
}
