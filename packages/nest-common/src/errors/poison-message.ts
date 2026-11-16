/**
 * Thrown by a consumer for a message that can never succeed — it fails its schema or references
 * nothing. The runner copies it to the dead-letter subject and terminates it (conventions §7.2).
 */
export class PoisonMessage extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PoisonMessage';
  }
}

/** Normalizes anything thrown into a message string; `err.message` is undefined for non-Error throws. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
