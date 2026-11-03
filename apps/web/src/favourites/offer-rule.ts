/**
 * When the account is offered (K9, the product owner): after the first save on this browser, once
 * more after the third, then never — and never to someone signed in.
 */
export function offerAfterSave(savesSoFar: number, signedIn: boolean): boolean {
  if (signedIn) return false;
  return savesSoFar === 1 || savesSoFar === 3;
}
