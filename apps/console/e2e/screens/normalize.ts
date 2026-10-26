// What varies from run to run in text, given one fixed text before a capture, so a baseline changes
// only when the screen does. A rule keeps its replacement close to the real text's width.

/** One rule: a pattern, its flags, and the fixed text it becomes. */
export type Rule = readonly [source: string, flags: string, replacement: string];

export const RULES: readonly Rule[] = [
  // Relative times ("Just now", "34 days ago", "Yesterday"): not <time> elements.
  ['\\b(Just now|just now|Yesterday|yesterday|\\d+ (minute|hour|day)s? ago)\\b', 'g', '3 days ago'],
  // A record's id, and a request ID.
  [
    '\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b',
    'g',
    '01a00000-0000-7000-8000-000000000000',
  ],
  ['\\b[0-9a-f]{32}\\b', 'g', '0123456789abcdef0123456789abcdef'],
  // A Place's public code, as stickers print it (4 + 4): alone, after "code", "is" or "· ", or
  // before " ·".
  ['(^|[Cc]ode |is |· )[A-Z0-9]{4} [A-Z0-9]{4}(?=$| ·| —|,)', 'g', '$1AB12 CD34'],
  // A date the run sets: a record's creation, an account's start.
  ['\\b\\d{1,2}/\\d{1,2}/\\d{4}\\b', 'g', '10/24/2026'],
  ['\\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2}, \\d{4}\\b', 'g', 'Oct 24, 2026'],
  // The console's own form: day, short month, year.
  ['\\b\\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4}\\b', 'g', '2 Oct 2026'],
  // A clock time the run sets (a provider resting, a task's next try) and the minutes to it.
  ['\\b(since|at|until) \\d{1,2}:\\d{2}\\b', 'g', '$1 14:05'],
  ['\\(in \\d+ min\\)', 'g', '(in 4 min)'],
];

/** The text as every run draws it. */
export function normalizeText(text: string, rules: readonly Rule[] = RULES): string {
  return rules.reduce(
    (current, [source, flags, replacement]) =>
      current.replace(new RegExp(source, flags), replacement),
    text,
  );
}

/**
 * Normalises the page's text, then keeps it so: React can re-render between this and the capture
 * (a refetch), putting the real text back, so a `MutationObserver` normalises again on every change,
 * before the next paint. Runs in the page (`page.evaluate(keepNormalized, RULES)`), so it is
 * self-contained; it writes only text that differs, so its own writes settle.
 */
export function keepNormalized(rules: readonly Rule[]): void {
  const apply = (text: string) =>
    rules.reduce(
      (current, [source, flags, replacement]) =>
        current.replace(new RegExp(source, flags), replacement),
      text,
    );
  const normalize = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';
      const next = apply(text);
      if (next !== text) node.nodeValue = next;
    }
  };
  normalize();
  const page = window as unknown as { normalizer?: MutationObserver };
  if (page.normalizer !== undefined) return;
  page.normalizer = new MutationObserver(normalize);
  page.normalizer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

/** Ends {@link keepNormalized}'s watch once the captures are taken. */
export function stopNormalizing(): void {
  const page = window as unknown as { normalizer?: MutationObserver };
  page.normalizer?.disconnect();
  delete page.normalizer;
}
