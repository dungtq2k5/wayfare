import type { Migration } from '../migrate';

/**
 * Synced records gained `addressVi`, and the server only resends a Place that changed: clearing
 * the cursors makes the next sync a full one, so every installed phone gets the address.
 */
export const migration0002: Migration = {
  version: 2,
  statements: ['DELETE FROM place_records', 'DELETE FROM sync_state'],
};
