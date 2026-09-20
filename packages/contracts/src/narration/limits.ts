/** Attempts a synthesis task gets before it fails for good (rdm-spec N-2). */
export const SYNTHESIS_TASK_ATTEMPTS = 3;

/** The delay before each retry of a failed task, by attempt; the last entry repeats. */
export const SYNTHESIS_RETRY_BACKOFF_MS = [5_000, 30_000] as const;

/** Consecutive failures before a provider is skipped for `PROVIDER_COOLDOWN_MS` (conventions §11.5). */
export const PROVIDER_FAILURE_THRESHOLD = 3;

/** The longest one translation or speech call may take. */
export const PROVIDER_CALL_TIMEOUT_MS = 20_000;

/** When a tourist device should ask again about a pending on-demand job (api-endpoints-plan §4.1). */
export const ON_DEMAND_RETRY_AFTER_MS = 5_000;

/** How often the gateway re-checks every socket's token (api-endpoints-plan §9). */
export const SOCKET_REVALIDATE_MS = 60_000;

/** A dictionary term's longest form (rdm-spec N-5's `term` column). */
export const MAX_PRONUNCIATION_TERM_LENGTH = 120;

/** The most text one pronunciation preview may synthesize (api-endpoints-plan §4.4). */
export const MAX_PREVIEW_CHARS = 500;

/** Where a dictionary fan-out stops, reports and warns (rdm-spec N-5). */
export const MAX_DICTIONARY_FANOUT_TARGETS = 2_000;

/** How many targets the fan-out turns into jobs per transaction. */
export const DICTIONARY_FANOUT_BATCH = 50;
