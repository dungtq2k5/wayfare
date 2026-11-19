/**
 * Removes a cookie from happy-dom's document. Its `Max-Age=0` leaves the cookie behind, empty
 * (a browser removes it), so a spec starts clean with a past `Expires` instead.
 */
export function forgetCookie(name: string): void {
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
