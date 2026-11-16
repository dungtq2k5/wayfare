import { CROCKFORD_ALPHABET, PUBLIC_CODE_LENGTH } from '@wayfare/contracts';

/** Random bytes a code needs: five bits per character. */
export const PUBLIC_CODE_ENTROPY_BYTES = Math.ceil((PUBLIC_CODE_LENGTH * 5) / 8);

/** How many fresh codes an insert tries before giving up (rdm-spec C-1). */
export const PUBLIC_CODE_ATTEMPTS = 5;

/**
 * A Place's printed code from `random` bytes (rdm-spec C-1): Crockford base32, five bits per
 * character, so it survives being read aloud. The caller supplies the randomness.
 */
export function publicCodeFrom(random: Uint8Array): string {
  if (random.length < PUBLIC_CODE_ENTROPY_BYTES) {
    throw new RangeError(`A public code needs ${PUBLIC_CODE_ENTROPY_BYTES} random bytes`);
  }
  let bits = 0;
  let buffer = 0;
  let code = '';
  for (const byte of random) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && code.length < PUBLIC_CODE_LENGTH) {
      bits -= 5;
      code += CROCKFORD_ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return code;
}
