/** A pronunciation entry (rdm-spec N-5), as the pipeline applies it. */
export interface PronunciationRule {
  readonly term: string;
  /** Null: every non-`vi` language. */
  readonly targetLang: string | null;
  readonly replacementType: 'SUB' | 'PHONEME';
  readonly replacement: string;
  readonly alphabet: string | null;
}

/** The pause between a Place's name and its description. */
export const NAME_BREAK = '<break time="600ms"/>';

const SPEAK_OPEN = '<speak>';
const SPEAK_CLOSE = '</speak>';

/** Text as SSML content: `&`, `<`, `>`, `"` and `'` escaped. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.codePointAt(0)};`);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * The rules for `lang`: its own entries and the every-language ones, a language-specific entry
 * winning for the same term. `vi` takes none — the source is never re-pronounced.
 */
export function rulesFor(rules: readonly PronunciationRule[], lang: string): PronunciationRule[] {
  if (lang === 'vi') return [];
  const byTerm = new Map<string, PronunciationRule>();
  for (const rule of rules) {
    if (rule.targetLang !== null && rule.targetLang !== lang) continue;
    const term = rule.term.normalize('NFC');
    const existing = byTerm.get(term);
    if (existing === undefined || (existing.targetLang === null && rule.targetLang !== null)) {
      byTerm.set(term, rule);
    }
  }
  return [...byTerm.values()];
}

/**
 * Applies the dictionary to already-escaped text in one pass: longest term first, whole words only
 * (Unicode letter and digit boundaries), each match wrapped in `<sub alias>` or `<phoneme>`.
 */
export function applyDictionary(escaped: string, rules: readonly PronunciationRule[]): string {
  if (rules.length === 0) return escaped;
  const byTerm = new Map(rules.map((rule) => [escapeXml(rule.term.normalize('NFC')), rule]));
  const terms = [...byTerm.keys()].toSorted((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}])`,
    'gu',
  );
  return escaped.normalize('NFC').replace(pattern, (match) => {
    const rule = byTerm.get(match)!;
    const replacement = escapeXml(rule.replacement);
    return rule.replacementType === 'SUB'
      ? `<sub alias="${replacement}">${match}</sub>`
      : `<phoneme alphabet="${escapeXml(rule.alphabet ?? 'ipa')}" ph="${replacement}">${match}</phoneme>`;
  });
}

/** A Place's final SSML body: the name, a pause, the description — escaped, then pronounced. */
export function placeSsmlBody(input: {
  readonly name: string;
  readonly description: string;
  readonly lang: string;
  readonly rules: readonly PronunciationRule[];
}): string {
  const rules = rulesFor(input.rules, input.lang);
  const say = (text: string) => applyDictionary(escapeXml(text.normalize('NFC')), rules);
  return `${say(input.name)}${NAME_BREAK}${say(input.description)}`;
}

/** The whole final SSML — what the cache key covers (rdm-spec N-3). */
export function wholeSsml(body: string): string {
  return `${SPEAK_OPEN}${body}${SPEAK_CLOSE}`;
}

const SENTENCE_END = /[.!?…。！？]/;
const WIDE_SENTENCE_END = /[。！？]/;

/**
 * The body cut into sentences, never inside a tag or inside a `<sub>`/`<phoneme>` element. A
 * sentence ends after `.`, `!`, `?` or `…` followed by whitespace, after a full-width stop, or at
 * a line break; its trailing whitespace stays with it.
 */
export function sentencesOf(body: string): string[] {
  const sentences: string[] = [];
  let current = '';
  let depth = 0;
  let index = 0;
  while (index < body.length) {
    const character = body[index]!;
    if (character === '<') {
      const close = body.indexOf('>', index);
      const tag = body.slice(index, close + 1);
      current += tag;
      if (tag.startsWith('</')) depth -= 1;
      else if (!tag.endsWith('/>')) depth += 1;
      index = close + 1;
      continue;
    }
    current += character;
    index += 1;
    if (depth > 0) continue;
    const next = body[index];
    const ends =
      character === '\n' ||
      WIDE_SENTENCE_END.test(character) ||
      (SENTENCE_END.test(character) && (next === undefined || /\s/.test(next)));
    if (ends) {
      while (index < body.length && /\s/.test(body[index]!)) current += body[index++];
      sentences.push(current);
      current = '';
    }
  }
  if (current !== '') sentences.push(current);
  return sentences;
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

/**
 * The body as `<speak>` documents of at most `maxBytes` UTF-8 bytes each, packed from whole
 * sentences in order (rdm-spec N-3). A single sentence over the limit is a refusal of the input.
 */
export function splitSsml(
  body: string,
  maxBytes: number,
): { ok: true; chunks: string[] } | { ok: false; reason: 'SENTENCE_TOO_LONG' } {
  const room = maxBytes - bytes(SPEAK_OPEN) - bytes(SPEAK_CLOSE);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentencesOf(body)) {
    if (bytes(sentence) > room) return { ok: false, reason: 'SENTENCE_TOO_LONG' };
    if (current !== '' && bytes(current) + bytes(sentence) > room) {
      chunks.push(wholeSsml(current));
      current = '';
    }
    current += sentence;
  }
  if (current !== '') chunks.push(wholeSsml(current));
  return { ok: true, chunks };
}
