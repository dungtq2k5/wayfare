import { ApiError } from '@wayfare/api-client';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { routeApiError } from './api-errors';
import { useAppStore } from './app-store';

const route = (error: unknown): void => routeApiError(error, useAppStore.getState());

/** A refusal is the answer; only a transport failure or a gateway fault is worth another try. */
const retry = (failures: number, error: Error): boolean =>
  failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500);

/** The one `QueryClient` (ADR 0029). Query persistence arrives with the local database. */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: route }),
  mutationCache: new MutationCache({ onError: route }),
  defaultOptions: { queries: { retry } },
});
