import { getRandomValues } from 'expo-crypto';

/**
 * Hermes has no Web Crypto: `crypto.getRandomValues` comes from expo-crypto, so contracts' `newId()`
 * (a UUIDv7 from the `uuid` package, which reads it) works in the app as on the server. Imported
 * first by the root layout.
 */
const scope = globalThis as { crypto?: { getRandomValues?: unknown } };
if (typeof scope.crypto?.getRandomValues !== 'function') {
  scope.crypto = { ...(scope.crypto ?? {}), getRandomValues };
}
