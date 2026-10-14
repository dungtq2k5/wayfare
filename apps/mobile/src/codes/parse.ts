import { canonicalPublicCode } from '@wayfare/contracts';

/** Where a code came from: the camera, the keyboard, or a link from outside the app. */
export type CodeSource = 'scan' | 'typed' | 'link';

/** What a scanned or linked text turned out to be. */
export type ParsedLink =
  /** A Place's code; `printed` when it came from a sticker's `/q/` URL, which counts as a scan. */
  | { readonly kind: 'code'; readonly code: string; readonly printed: boolean }
  /** A Wayfare `/q/` or `/p/` link whose code does not canonicalize. */
  | { readonly kind: 'bad-link' }
  /** A Wayfare link that is not a Place (the site's home, say): the app just opens. */
  | { readonly kind: 'not-place' }
  /** Anything else: never opened. */
  | { readonly kind: 'not-wayfare' };

/** The hosts a printed or shared link uses, which never change, plus the build's own (local) ones. */
export interface LinkBases {
  readonly qr: string;
  readonly link: string;
}

const PRODUCTION = ['https://go.wayfare.app', 'https://wayfare.app'];
const SCHEME = 'wayfare:';

const originOf = (base: string): string | null => {
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
};

/**
 * Reads a scanned or linked text. Only `<base>/q/<code>` and `<base>/p/<code>` are codes, on the
 * production hosts (https only) or the build's own bases (which may be plain http locally); the app's
 * scheme, `wayfare://p/<code>`, too. A trailing slash, a query and a fragment are ignored. The
 * scanner must never become a way to open an arbitrary link.
 */
export function parseLink(text: string, bases: LinkBases): ParsedLink {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { kind: 'not-wayfare' };
  }
  let segments: string[];
  if (url.protocol === SCHEME) {
    // `wayfare://p/CODE`: the first segment is the URL's host.
    segments = [url.hostname, ...url.pathname.split('/')].filter((part) => part.length > 0);
  } else {
    const own = [bases.qr, bases.link].map(originOf).filter((origin) => origin !== null);
    const allowed = PRODUCTION.includes(url.origin) || own.includes(url.origin);
    if (!allowed || (url.protocol !== 'https:' && !own.includes(url.origin))) {
      return { kind: 'not-wayfare' };
    }
    segments = url.pathname.split('/').filter((part) => part.length > 0);
  }
  const [kind, raw, ...rest] = segments;
  if (kind !== 'q' && kind !== 'p') return { kind: 'not-place' };
  if (raw === undefined || rest.length > 0) return { kind: 'bad-link' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { kind: 'bad-link' };
  }
  const code = canonicalPublicCode(decoded);
  return code === null ? { kind: 'bad-link' } : { kind: 'code', code, printed: kind === 'q' };
}
