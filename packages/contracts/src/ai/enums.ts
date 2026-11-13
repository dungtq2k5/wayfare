/** The model provider that served a generation — rdm-spec X-1 `provider`. */
export enum AiProvider {
  GEMINI = 'GEMINI',
  PROXYPAL = 'PROXYPAL',
}

/** Every `AiProvider` value. */
export const AI_PROVIDERS = Object.values(AiProvider);

/** What a generation was for — rdm-spec X-1 `purpose`. */
export enum AiPurpose {
  DESCRIPTION_ENHANCEMENT = 'DESCRIPTION_ENHANCEMENT',
  ITINERARY_SUGGESTION = 'ITINERARY_SUGGESTION',
}

/** Every `AiPurpose` value. */
export const AI_PURPOSES = Object.values(AiPurpose);

/** How a generation ended — rdm-spec X-1 `outcome`. */
export enum AiOutcome {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  TIMEOUT = 'TIMEOUT',
  OUTPUT_REJECTED = 'OUTPUT_REJECTED',
  REFUSED = 'REFUSED',
}

/** Every `AiOutcome` value. */
export const AI_OUTCOMES = Object.values(AiOutcome);
