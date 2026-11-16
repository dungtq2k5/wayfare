import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';
import type { Translator } from '../i18n/messages';

/** A failure's code, `INTERNAL` for anything that is not an API answer. */
export const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'INTERNAL';

/** A failure's request ID, which support traces (C13). */
export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

/** How many minutes a `429` says to wait, rounded up; 15 when it does not say. */
export function retryMinutes(error: ApiError): number {
  const seconds = Number(
    (error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds,
  );
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : 15;
}

/** The sentence for a failure's code (handoff §5), the generic one for a code without its own. */
export function errorText(error: unknown, { t, tDynamic }: Translator): string {
  if (!(error instanceof ApiError)) return t('error.generic');
  if (error.code === 'RATE_LIMITED')
    return t('error.RATE_LIMITED', { minutes: retryMinutes(error) });
  if (error.code === NETWORK_ERROR_CODE) return t('error.NETWORK_ERROR');
  return tDynamic(`error.${error.code}`);
}

/** A failure as a page can be handed it, from the server or the browser. */
export interface Failure {
  readonly code: string;
  readonly requestId?: string | undefined;
}

/** Plain enough to cross from a server component: the code and the request ID. */
export function failureOf(error: unknown): Failure {
  return { code: codeOf(error), requestId: requestIdOf(error) };
}

/** No answer from the gateway, or its own `503`: the API is down (K14, C16a). */
export function isUnreachable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === NETWORK_ERROR_CODE || error.code === 'UPSTREAM_UNAVAILABLE')
  );
}
