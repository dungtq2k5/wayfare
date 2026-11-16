import { ApiError } from '@wayfare/api-client';
import { describe, expect, it } from 'vitest';
import { goneAnswer, unavailableView } from './unavailable-view';

describe('a tour the phone can’t show', () => {
  it('is gone only on 404 TOUR_UNAVAILABLE, with its area when the gateway names one', () => {
    expect(
      goneAnswer(new ApiError(404, 'TOUR_UNAVAILABLE', 'gone', { areaCode: 'hoi-an' })),
    ).toEqual({ gone: true, areaCode: 'hoi-an' });
    expect(goneAnswer(new ApiError(404, 'TOUR_UNAVAILABLE', 'gone'))).toEqual({
      gone: true,
      areaCode: null,
    });
    expect(goneAnswer(new ApiError(503, 'UPSTREAM_UNAVAILABLE', 'down'))).toBeNull();
    expect(goneAnswer(new ApiError(0, 'NETWORK_ERROR', 'offline'))).toBeNull();
    expect(goneAnswer(new Error('SQLITE_BUSY'))).toBeNull();
  });

  it('shows the skeleton while asking and while a known tour waits for its sync', () => {
    expect(unavailableView(false, { isError: false })).toBe('waiting');
    expect(unavailableView(false, { isError: false, data: { gone: false, areaCode: null } })).toBe(
      'waiting',
    );
  });

  it('says a failed ask, never "gone"', () => {
    expect(unavailableView(false, { isError: true })).toBe('failed');
    expect(unavailableView(false, { isError: false, data: { gone: true, areaCode: null } })).toBe(
      'gone',
    );
  });

  it('offline, says it isn’t on the phone', () => {
    expect(unavailableView(true, { isError: true })).toBe('offline');
  });
});
