import { AUDIT_RECORD } from './audit.events';
import type { EventDefinition } from './event-definition';

/** Every declared event, by subject. A subject missing here does not exist (api-endpoints-plan §10). */
export const EVENT_REGISTRY: Readonly<Record<string, EventDefinition>> = {
  [AUDIT_RECORD.subject]: AUDIT_RECORD,
};
