import { ApiError } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import { linkFailure } from './link-failure';

describe('a failed emailed link (WE1e)', () => {
  it('is expired when the gateway refuses the token: spent, expired or malformed', () => {
    expect(linkFailure(new ApiError(410, 'TOKEN_EXPIRED', 'gone'))).toBe('expired');
    expect(linkFailure(new ApiError(400, 'VALIDATION_FAILED', 'bad token'))).toBe('expired');
  });

  it('is a failed request, never an expired link, offline', () => {
    expect(linkFailure(new TypeError('Failed to fetch'))).toBe('failed');
  });

  it('is a failed request, never an expired link, on the server’s error', () => {
    expect(linkFailure(new ApiError(500, 'INTERNAL', 'boom'))).toBe('failed');
    expect(linkFailure(new ApiError(409, 'EMAIL_TAKEN', 'taken meanwhile'))).toBe('failed');
  });
});
