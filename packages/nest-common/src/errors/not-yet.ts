/**
 * Thrown by a consumer for a message that arrived before what it is about — an event the relay
 * delivered ahead of the one it follows (conventions §7.2). The runner redelivers it with the usual
 * backoff, logged as a wait rather than a failure, and dead-letters it only if it never settles.
 */
export class NotYet extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NotYet';
  }
}
