import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { DIAGNOSTICS_ENABLED } from '../env';
import { createWalkLog } from './walk-log';
import type { LogFile } from './walk-log';

const file = new File(Paths.document, 'walk-log.jsonl');

const onDisk: LogFile = {
  size: () => (file.exists ? (file.size ?? 0) : 0),
  append: (text) => {
    // A Diagnostics build also prints each line, so `adb logcat -s ReactNativeJS` can capture a walk
    // the phone cannot hand over otherwise.
    if (DIAGNOSTICS_ENABLED) console.info(`WALKLOG ${text.trimEnd()}`);
    if (!file.exists) file.create({ intermediates: true });
    file.write(text, { append: true });
    return Promise.resolve();
  },
  read: () => file.text(),
  write: (text) => {
    file.write(text);
    return Promise.resolve();
  },
};

/** The walk's log: each engine call, walk state change and narration start. */
export const walkLog = createWalkLog(onDisk);

/** *Share walk log*: hands the file to Android's share sheet; false when there is nothing to share. */
export async function shareWalkLog(): Promise<boolean> {
  if (!file.exists || !(await isAvailableAsync())) return false;
  await shareAsync(file.uri, { mimeType: 'application/x-ndjson', dialogTitle: 'Wayfare walk log' });
  return true;
}

/** *Forget this install*. */
export function deleteWalkLog(): void {
  if (file.exists) file.delete();
}
