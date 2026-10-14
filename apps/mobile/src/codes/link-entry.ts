import { LINK_BASE_URL, QR_BASE_URL } from '../env';
import { parseLink } from './parse';
import { setPending, useCodeStore } from './store';

/** The Map's path: every link lands there, and the Map opens what is pending. */
export const MAP_PATH = '/map';

/**
 * Where an incoming link goes, before routing sees it. A Place's code is kept as pending (it waits
 * through the first run if need be) and the app goes to the Map, which opens it; a broken Place link
 * leaves its sheet for the Map; a Wayfare link that is not a Place just opens the Map. Anything else
 * is the app's own navigation and passes through unchanged.
 */
export function routeForLink(path: string): string {
  const parsed = parseLink(path, { qr: QR_BASE_URL, link: LINK_BASE_URL });
  switch (parsed.kind) {
    case 'code':
      setPending({ code: parsed.code, source: 'link', printed: parsed.printed });
      return MAP_PATH;
    case 'bad-link':
      useCodeStore.setState({ result: { kind: 'bad-link' } });
      return MAP_PATH;
    case 'not-place':
      return MAP_PATH;
    case 'not-wayfare':
      return path;
  }
}
