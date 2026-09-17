/** How often a running job refreshes its heartbeat (rdm-spec N-1). */
export const JOB_HEARTBEAT_MS = 5_000;

/** A running job whose heartbeat is older than this is reclaimed (rdm-spec N-1). */
export const JOB_STALE_AFTER_MS = 5 * 60_000;
