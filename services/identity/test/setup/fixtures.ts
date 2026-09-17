// Small builders shared by the identity integration suites.
import { LEGAL_DOCUMENT_VERSIONS } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import type { RequestContext } from '@wayfare/nest-common';
import { buildAnonymousContext, buildDeviceContext } from '@wayfare/nest-common/testing';
import type { identityServices } from './services';

type Services = ReturnType<typeof identityServices>;

export const PASSWORD = 'correct horse battery';

export const CLIENT = {
  console: identityGrpc.SessionClient.SESSION_CLIENT_CONSOLE,
  web: identityGrpc.SessionClient.SESSION_CLIENT_WEB,
  mobile: identityGrpc.SessionClient.SESSION_CLIENT_MOBILE,
} as const;

let counter = 0;

/** A fresh, unique address. */
export function freshEmail(): string {
  counter += 1;
  return `person${Date.now()}${counter}@example.com`;
}

/** Registers a device and returns its id, secret and a device context for it. */
export async function registerDevice(services: Services) {
  const response = await services.devices.registerDevice(
    {
      platform: identityGrpc.Platform.PLATFORM_ANDROID,
      appVersion: '1.0.0',
      contentLocale: 'en',
      privacyPolicyVersion: LEGAL_DOCUMENT_VERSIONS.PRIVACY_POLICY,
    },
    buildAnonymousContext(),
  );
  return { ...response, context: buildDeviceContext({ deviceId: response.deviceId }) };
}

/** Registers an account and returns its session. */
export async function registerAccount(
  services: Services,
  options: { email?: string; client?: identityGrpc.SessionClient; context?: RequestContext } = {},
) {
  const email = options.email ?? freshEmail();
  const { session } = await services.auth.register(
    {
      email,
      password: PASSWORD,
      preferredLocale: 'en',
      termsVersion: LEGAL_DOCUMENT_VERSIONS.TERMS_OF_SERVICE,
      client: options.client ?? CLIENT.console,
    },
    options.context ?? buildAnonymousContext(),
  );
  return { email, session: session! };
}

/** The claims of a JWT, unverified — for assertions only. */
export function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

/** The `wf-error-code` of a rejected call. */
export async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: unknown) => e,
  );
  const rpc = error as { getError?: () => { metadata: { get(key: string): unknown[] } } };
  if (typeof rpc.getError !== 'function') throw error;
  return String(rpc.getError().metadata.get('wf-error-code')[0]);
}
