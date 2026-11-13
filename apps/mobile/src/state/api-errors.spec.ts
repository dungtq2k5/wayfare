import { ApiError } from '@wayfare/api-client';
import { describe, expect, it, vi } from 'vitest';
import { routeApiError } from './api-errors';

const actions = () => ({ requireUpdate: vi.fn(), requirePolicy: vi.fn() });

describe('routeApiError', () => {
  it('sends APP_VERSION_UNSUPPORTED to Update required with the minimum version', () => {
    const a = actions();
    routeApiError(
      new ApiError(426, 'APP_VERSION_UNSUPPORTED', 'x', { minimumVersion: '2.0.0' }),
      a,
    );
    expect(a.requireUpdate).toHaveBeenCalledWith('2.0.0');
    expect(a.requirePolicy).not.toHaveBeenCalled();
  });

  it('re-shows the notice at the version in LEGAL_VERSION_OUTDATED', () => {
    const a = actions();
    routeApiError(
      new ApiError(409, 'LEGAL_VERSION_OUTDATED', 'x', {
        document: 'PRIVACY_POLICY',
        currentVersion: '2027-01-01',
      }),
      a,
    );
    expect(a.requirePolicy).toHaveBeenCalledWith('2027-01-01');
  });

  it('leaves every other failure to the caller', () => {
    const a = actions();
    routeApiError(new ApiError(500, 'INTERNAL', 'x'), a);
    routeApiError(new Error('boom'), a);
    routeApiError(new ApiError(409, 'LEGAL_VERSION_OUTDATED', 'x'), a);
    expect(a.requireUpdate).not.toHaveBeenCalled();
    expect(a.requirePolicy).not.toHaveBeenCalled();
  });
});
