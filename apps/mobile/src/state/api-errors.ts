import { ApiError } from '@wayfare/api-client';

/** What the gateway's two app-wide refusals change in the app. */
export interface ApiErrorActions {
  requireUpdate: (minimumVersion: string) => void;
  requirePolicy: (currentVersion: string) => void;
}

const stringField = (details: unknown, key: string): string | null => {
  const value = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' ? value : null;
};

/**
 * Routes the refusals that concern the whole app, whichever call met them: `426
 * APP_VERSION_UNSUPPORTED` → *Update required*; `409 LEGAL_VERSION_OUTDATED` → the notice again, at
 * the version in its details. Anything else is the caller's own to show.
 */
export function routeApiError(error: unknown, actions: ApiErrorActions): void {
  if (!(error instanceof ApiError)) return;
  if (error.code === 'APP_VERSION_UNSUPPORTED') {
    actions.requireUpdate(stringField(error.details, 'minimumVersion') ?? '');
  } else if (error.code === 'LEGAL_VERSION_OUTDATED') {
    const version = stringField(error.details, 'currentVersion');
    if (version !== null) actions.requirePolicy(version);
  }
}
