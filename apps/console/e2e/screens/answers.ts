// The gateway's answers to what the browser asks, faked where the stack cannot give a state on its
// own (a refusal, a link's result, a call held in flight). Only the browser's own requests: a page's
// server-side reads never reach `page.route`, so those states are real records.
import type { Page, Route } from '@playwright/test';

const API = '**/api/v1';

function answer(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Answers `method path` with `data` in the gateway's envelope. */
export async function reply(
  page: Page,
  method: string,
  path: string,
  data: unknown,
): Promise<void> {
  await page.route(`${API}${path}`, (route) =>
    route.request().method() === method
      ? answer(route, method === 'POST' ? 201 : 200, { data })
      : route.fallback(),
  );
}

/** Refuses `method path` with an error code, as the gateway would. */
export async function refuse(
  page: Page,
  method: string,
  path: string,
  status: number,
  code: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await page.route(`${API}${path}`, (route) =>
    route.request().method() === method
      ? answer(route, status, {
          error: {
            code,
            message: code,
            requestId: 'req_screens_0001',
            ...(details ? { details } : {}),
          },
        })
      : route.fallback(),
  );
}

/** Holds `method path` unanswered: the screen's busy state. */
export async function hold(page: Page, method: string, path: string): Promise<void> {
  await page.route(`${API}${path}`, (route) =>
    route.request().method() === method ? undefined : route.fallback(),
  );
}

/**
 * Answers every `GET path` with the first answer the stack gave: a state that would move on its own
 * during the captures (a Place going live) stands still until `page.unroute`.
 */
export async function freeze(page: Page, path: string): Promise<void> {
  let body: string | undefined;
  await page.route(`${API}${path}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    body ??= await (await route.fetch()).text();
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

/**
 * Answers every `GET path` with the stack's own answer changed by `edit`: a state the stack holds
 * only for a moment (a job running, audio being made) drawn on real records.
 */
export async function rewrite<T>(
  page: Page,
  path: string,
  edit: (answer: T) => void,
): Promise<void> {
  await page.route(`${API}${path}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    // A refusal or an outage passes as it came: only a real answer is drawn changed.
    if (!response.ok()) return route.fulfill({ response });
    const answer = (await response.json()) as T;
    edit(answer);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(answer),
    });
  });
}
