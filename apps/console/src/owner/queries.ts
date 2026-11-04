'use client';

import { useQuery } from '@tanstack/react-query';
import type { ownerPlacesGet } from '@wayfare/api-client';
import {
  ownerBillingOverview,
  ownerBillingPlans,
  ownerPlacesLimits,
  ownerPlacesList,
  ownerSubmissionsList,
} from '@wayfare/api-client';

export type OwnerPlaceRow = Awaited<ReturnType<typeof ownerPlacesList>>['data'][number];
export type OwnerPlaceDetail = Awaited<ReturnType<typeof ownerPlacesGet>>['data'];
export type OwnerLimits = Awaited<ReturnType<typeof ownerPlacesLimits>>['data'];
export type BillingOverview = Awaited<ReturnType<typeof ownerBillingOverview>>['data'];
export type PurchasablePlan = Awaited<ReturnType<typeof ownerBillingPlans>>['data'][number];
export type OwnerSubmissionRow = Awaited<ReturnType<typeof ownerSubmissionsList>>['data'][number];

/** The owner's own reads, shared by Home, My venues and a venue's page. */
export const OWNER_KEYS = {
  places: ['owner-places'] as const,
  place: (id: string) => ['owner-place', id] as const,
  limits: ['owner-limits'] as const,
  pending: ['owner-submissions', 'PENDING'] as const,
  billing: ['owner-billing'] as const,
  plans: ['owner-plans'] as const,
  boosts: ['owner-boosts'] as const,
};

export function useOwnerPlaces(initial?: OwnerPlaceRow[], enabled = true) {
  return useQuery({
    queryKey: OWNER_KEYS.places,
    enabled,
    queryFn: async () => (await ownerPlacesList()).data,
    ...(initial === undefined ? {} : { initialData: initial }),
  });
}

export function useLimits(enabled = true) {
  return useQuery({
    queryKey: OWNER_KEYS.limits,
    enabled,
    queryFn: async () => (await ownerPlacesLimits()).data,
  });
}

/** The waiting submissions: a new venue's name, which holds a place (K7). */
export function usePendingSubmissions() {
  return useQuery({
    queryKey: OWNER_KEYS.pending,
    queryFn: async () => (await ownerSubmissionsList({ status: 'PENDING', limit: 50 })).data,
  });
}

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: OWNER_KEYS.billing,
    enabled,
    queryFn: async () => (await ownerBillingOverview()).data,
  });
}

export function usePlans(enabled = true) {
  return useQuery({
    queryKey: OWNER_KEYS.plans,
    enabled,
    queryFn: async () => (await ownerBillingPlans()).data,
    staleTime: 5 * 60_000,
  });
}
