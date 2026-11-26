import { ApiError } from '@wayfare/api-client';

/**
 * What a failed emailed link says (WE1e): *expired* only when the gateway refused the token itself —
 * spent or expired (`410 TOKEN_EXPIRED`) or not a token at all (`400 VALIDATION_FAILED`). Any other
 * failure, offline or a `5xx`, is the request's, and the link may still work: the error state, with
 * *Try again* (conventions §12.8: a failure never looks like something else).
 */
export function linkFailure(error: unknown): 'expired' | 'failed' {
  return error instanceof ApiError &&
    (error.code === 'TOKEN_EXPIRED' || error.code === 'VALIDATION_FAILED')
    ? 'expired'
    : 'failed';
}
