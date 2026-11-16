/** A plan's accounts: all of them, and by state (api-endpoints-plan §6.1). */
export interface PlanSubscriberCounts {
  readonly total: number;
  readonly active: number;
  readonly pastDue: number;
  readonly cancelling: number;
  readonly pinned: number;
}

/** A plan nobody is on. */
export const NO_SUBSCRIBERS: PlanSubscriberCounts = {
  total: 0,
  active: 0,
  pastDue: 0,
  cancelling: 0,
  pinned: 0,
};
