import { APP_VERSION_HEADER, CLIENT_HEADER } from '@wayfare/contracts';
import type { WayfareClient } from '@wayfare/contracts';

/** A failed call: the envelope's `code`, `details` and `requestId`, or a transport failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The code of a call that never got an answer: no network, a timeout, a reset. */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

/** Who supplies the bearer, and what to do when the gateway refuses it. */
export interface ApiSession {
  /** The token to send, or null for an anonymous call; may fetch one first. */
  accessToken(): Promise<string | null>;
  /**
   * A `401` came back for `usedToken`. True when a fresh token is ready: the call is retried
   * once, and only once.
   */
  recover(error: ApiError, usedToken: string | null): Promise<boolean>;
}

/** `RequestInit` plus what only this client reads. */
export interface ApiRequestInit extends RequestInit {
  /**
   * No bearer, and no recovery on a `401`: for the calls that obtain a token, which must not
   * ask the session for one.
   */
  anonymous?: boolean;
}

/** What every request carries, set once per app (conventions §12.4). */
export interface ApiClientConfig {
  /** Up to and including `/api/v1`, no trailing slash. */
  readonly baseUrl: string;
  readonly client: WayfareClient;
  /** Sent as `X-Wayfare-App-Version` when the client is `mobile`. */
  readonly appVersion?: string;
  readonly session?: ApiSession;
  /** The transport; the platform's `fetch` unless a test supplies one. */
  readonly fetch?: typeof fetch;
}

let config: ApiClientConfig | undefined;

/** Sets the base URL, the client kind and the session. Call once, before the first request. */
export function configureApiClient(next: ApiClientConfig): void {
  config = next;
}

function configured(): ApiClientConfig {
  if (config === undefined) throw new Error('configureApiClient() has not been called');
  return config;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown };
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  const error = body?.error;
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
  const message = typeof error?.message === 'string' ? error.message : response.statusText;
  const requestId = typeof error?.requestId === 'string' ? error.requestId : undefined;
  return new ApiError(response.status, code, message, error?.details, requestId);
}

async function send(
  settings: ApiClientConfig,
  url: string,
  { anonymous: _anonymous, ...options }: ApiRequestInit,
  token: string | null,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set(CLIENT_HEADER, settings.client);
  if (settings.client === 'mobile' && settings.appVersion !== undefined)
    headers.set(APP_VERSION_HEADER, settings.appVersion);
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  if (typeof options.body === 'string' && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  try {
    return await (settings.fetch ?? fetch)(`${settings.baseUrl}${url}`, { ...options, headers });
  } catch (cause) {
    if (options.signal?.aborted === true) throw cause;
    throw new ApiError(0, NETWORK_ERROR_CODE, cause instanceof Error ? cause.message : 'No answer');
  }
}

/**
 * The mutator every generated hook calls (ADR 0028): it adds the client headers and the bearer,
 * returns the documented envelope (`{ data, meta? }`) — `undefined` for a `204` or a `304` — and
 * throws an `ApiError` for anything else.
 * A `401` asks the session to recover and retries once.
 */
export async function apiFetch<T>(url: string, options: ApiRequestInit = {}): Promise<T> {
  const settings = configured();
  const session = options.anonymous === true ? undefined : settings.session;
  let token = (await session?.accessToken()) ?? null;
  let response = await send(settings, url, options, token);
  if (response.status === 401 && session !== undefined) {
    const error = await toApiError(response);
    if (!(await session.recover(error, token))) throw error;
    token = await session.accessToken();
    response = await send(settings, url, options, token);
  }
  // A 304 answers an `If-None-Match` the caller sent: unchanged, with nothing to read.
  if (response.status === 304 || response.status === 204) return undefined as T;
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}
