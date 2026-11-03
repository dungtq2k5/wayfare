// What the global setup made, for the specs: written once per run.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WebPlace } from './places';

export const STATE_FILE = resolve(__dirname, '..', '..', 'test-results', '.web-state.json');

export interface WebState {
  readonly church: WebPlace;
  readonly opera: WebPlace;
  readonly gone: WebPlace;
}

export function state(): WebState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as WebState;
}
