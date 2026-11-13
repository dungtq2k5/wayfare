/**
 * K5: a failed sync is said only online — offline, the offline note says it — and only when the
 * screen has nothing of the phone's own to show; with local data, the screen shows that.
 */
export const syncFailureShown = (error: string | null, offline: boolean, nothingLocal: boolean) =>
  error !== null && !offline && nothingLocal;
