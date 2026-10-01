import * as Battery from 'expo-battery';
import { LOG_FILE } from './config';

export type LogEvent =
  | {
      readonly type: 'engineCall';
      readonly kind: 'evaluate' | 'reconcile';
      readonly now: number;
      readonly fix?: { lat: number; lng: number; accuracyM: number };
      readonly decision: string | null;
    }
  | {
      readonly type: 'audio';
      readonly event: 'start' | 'end' | 'duck' | 'resume' | 'interrupted';
      readonly placeId?: string;
    }
  | { readonly type: 'battery'; readonly level: number }
  | { readonly type: 'appState'; readonly state: string }
  | { readonly type: 'diag'; readonly message: string };

/** One JSONL line per event, timestamped, appended so a crash loses nothing already written. */
export function log(event: LogEvent): void {
  const line = `${JSON.stringify({ t: Date.now(), ...event })}\n`;
  if (!LOG_FILE.exists) LOG_FILE.create();
  LOG_FILE.write(line, { append: true });
}

const BATTERY_SAMPLE_MS = 5 * 60_000;

/** A battery reading every 5 minutes (W6), until `stop()` is called. */
export function startBatterySampling(): { stop: () => void } {
  const sample = () => {
    Battery.getBatteryLevelAsync()
      .then((level) => log({ type: 'battery', level }))
      .catch(() => undefined);
  };
  sample();
  const id = setInterval(sample, BATTERY_SAMPLE_MS);
  return { stop: () => clearInterval(id) };
}
