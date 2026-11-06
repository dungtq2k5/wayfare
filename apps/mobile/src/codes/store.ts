import { create } from 'zustand';
import type { CodeSource } from './parse';

/** A code waiting for the Map: from a link (possibly before the first run), or the scanner. */
export interface PendingCode {
  readonly code: string;
  readonly source: CodeSource;
  /** From a sticker's `/q/` URL: counted as a scan. */
  readonly printed: boolean;
  /** From a tour's `/t/` link. */
  readonly tour?: boolean;
}

/** What the Map shows for a code that did not open a Place, as a sheet with a next step. */
export type CodeResult =
  | {
      readonly kind: 'looking-up' | 'no-longer' | 'no-such-code' | 'offline';
      readonly code: string;
      /** Offline with a tour's link that isn't on the phone yet (TM6c). */
      readonly tour?: boolean;
    }
  | { readonly kind: 'bad-link' }
  /** A tour no longer on Wayfare (TM5b), with its area for *See tours* when the gateway named it. */
  | { readonly kind: 'tour-gone'; readonly areaCode: string | null };

/** A Place a code opened, for the Map to move to and show at half. */
export interface OpenedPlace {
  readonly seq: number;
  readonly placeId: string;
  readonly areaId: string | null;
  readonly location: { readonly lat: number; readonly lng: number };
}

interface CodeState {
  pending: PendingCode | null;
  result: CodeResult | null;
  opened: OpenedPlace | null;
}

export const useCodeStore = create<CodeState>(() => ({
  pending: null,
  result: null,
  opened: null,
}));

/** Keeps one code for the Map; a second link before it is taken replaces it (one sheet). */
export function setPending(pending: PendingCode): void {
  useCodeStore.setState({ pending });
}

/** The Map takes the waiting code once. */
export function takePending(): PendingCode | null {
  const { pending } = useCodeStore.getState();
  if (pending !== null) useCodeStore.setState({ pending: null });
  return pending;
}
