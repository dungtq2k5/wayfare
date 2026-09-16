/** The client kinds that may call the gateway (api-endpoints-plan §0.3). */
export const WAYFARE_CLIENTS = ['console', 'web', 'mobile'] as const;

/** Value of the `X-Wayfare-Client` header. */
export type WayfareClient = (typeof WAYFARE_CLIENTS)[number];

/** Name of the header every request must send. */
export const CLIENT_HEADER = 'x-wayfare-client';

/** True when `value` is a known client kind. */
export function isWayfareClient(value: unknown): value is WayfareClient {
  return typeof value === 'string' && (WAYFARE_CLIENTS as readonly string[]).includes(value);
}
