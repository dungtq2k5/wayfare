// One shard of the screens (`E2E_SCREENS_RANGE=16-22`): the spec files numbered up to its last run,
// but only its own are checked and drawn. Later specs draw records earlier ones made, so a shard
// replays the specs before its range, `look` skipped, and the stack reaches each of its states as a
// whole run would. Unset, every spec runs and draws.
import { basename } from 'node:path';

const [from = 1, to = 99] = (process.env.E2E_SCREENS_RANGE || '1-99').split('-').map(Number);

/** The specs a shard runs: every numbered file up to its range's end. */
export const SCREENS_MATCH = new RegExp(
  `screens/(${Array.from({ length: to }, (_, index) => String(index + 1).padStart(2, '0')).join('|')})-[^/]+\\.screen\\.ts$`,
);

/** Whether a spec file is only replayed, for the records it leaves: before the shard's range. */
export function replayed(file: string): boolean {
  return Number(basename(file).slice(0, 2)) < from;
}
