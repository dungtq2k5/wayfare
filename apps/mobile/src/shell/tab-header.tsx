import { SwitchPill } from '../language/switch-status';
import { ScreenHeader } from '../ui/screen-header';
import { WalkChip } from '../walk/walk-chip';

/** A tab's large header: the walk chip beside the title, the language switch's pill under it. */
export function TabHeader({ title }: { title: string }) {
  return <ScreenHeader title={title} accessory={<WalkChip />} below={<SwitchPill />} />;
}
