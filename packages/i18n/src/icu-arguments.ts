/** How far a quoted run reaches from an apostrophe at `start`, as ICU quoting defines it. */
function skipQuote(message: string, start: number): number {
  const next = message[start + 1];
  if (next === "'") return start + 1;
  if (next !== '{' && next !== '}' && next !== '#') return start;
  const end = message.indexOf("'", start + 2);
  return end === -1 ? message.length : end;
}

/** The index of the `}` closing the `{` at `open`, or the end of the message. */
function matchBrace(message: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < message.length) {
    const char = message[index];
    if (char === "'") {
      index = skipQuote(message, index);
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return message.length;
}

/** The index of `separator` at the top level of `part`, or -1. */
function topLevelIndex(part: string, separator: string): number {
  let depth = 0;
  let index = 0;
  while (index < part.length) {
    const char = part[index];
    if (char === "'") {
      index = skipQuote(part, index);
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (depth === 0 && char === separator) {
      return index;
    }
    index += 1;
  }
  return -1;
}

/** The kind of value an argument takes: its ICU type word, or `plain` for `{name}`. */
export type IcuArgumentKind =
  'plain' | 'number' | 'plural' | 'selectordinal' | 'date' | 'time' | 'select';

/** One argument: its kind, and for a `select` the option names it chooses between. */
export interface IcuArgument {
  readonly kind: IcuArgumentKind;
  readonly options: readonly string[];
}

const KINDS: readonly IcuArgumentKind[] = [
  'number',
  'plural',
  'selectordinal',
  'date',
  'time',
  'select',
];

/** The names that open each option body of a plural or select: `one {…} other {…}` → `one`, `other`. */
function optionNames(options: string): string[] {
  const names: string[] = [];
  let index = 0;
  let name = '';
  while (index < options.length) {
    const char = options[index];
    if (char === "'") {
      index = skipQuote(options, index);
    } else if (char === '{') {
      names.push(name.trim());
      name = '';
      index = matchBrace(options, index);
    } else {
      name += char;
    }
    index += 1;
  }
  return names;
}

/** An argument seen again keeps the more specific kind (`{n, plural, …}` beats a plain `{n}`). */
function record(found: Map<string, IcuArgument>, name: string, next: IcuArgument): void {
  const known = found.get(name);
  if (known === undefined || known.kind === 'plain') {
    found.set(name, next);
  } else if (next.kind === 'select' && known.kind === 'select') {
    found.set(name, { kind: 'select', options: [...new Set([...known.options, ...next.options])] });
  }
}

/** Arguments inside a plural's or a select's option bodies — `one {# of {total}}` holds `total`. */
function collectOptions(options: string, names: Map<string, IcuArgument>): void {
  let index = 0;
  while (index < options.length) {
    if (options[index] === "'") {
      index = skipQuote(options, index);
    } else if (options[index] === '{') {
      const end = matchBrace(options, index);
      collect(options.slice(index + 1, end), names);
      index = end;
    }
    index += 1;
  }
}

/** Every argument in a message, options included. */
function collect(message: string, names: Map<string, IcuArgument>): void {
  let index = 0;
  while (index < message.length) {
    if (message[index] === "'") {
      index = skipQuote(message, index);
    } else if (message[index] === '{') {
      const end = matchBrace(message, index);
      const inner = message.slice(index + 1, end);
      const comma = topLevelIndex(inner, ',');
      const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
      const rest = comma === -1 ? '' : inner.slice(comma + 1);
      const typeEnd = topLevelIndex(rest, ',');
      const type = (typeEnd === -1 ? rest : rest.slice(0, typeEnd)).trim();
      const kind = (KINDS as readonly string[]).includes(type)
        ? (type as IcuArgumentKind)
        : 'plain';
      if (name !== '') {
        record(names, name, {
          kind,
          options: kind === 'select' && typeEnd !== -1 ? optionNames(rest.slice(typeEnd + 1)) : [],
        });
      }
      if (comma !== -1) {
        // `number`, `date` and `time` carry a style, not a submessage; the choices do.
        if (
          typeEnd !== -1 &&
          (type === 'plural' || type === 'select' || type === 'selectordinal')
        ) {
          collectOptions(rest.slice(typeEnd + 1), names);
        }
      }
      index = end;
    }
    index += 1;
  }
}

/**
 * The argument names an ICU message uses. A translation must use exactly the same ones: one that
 * drops `{count}` renders "You have  places" and passes every test that does not render it
 * (rdm-spec N-6), so the bundle job compares these sets and keeps English where they differ.
 *
 * It reads braces rather than parsing ICU in full — enough to tell an argument from a plural's
 * option body, and to respect ICU's `'{'` quoting.
 */
export function icuArguments(message: string): Set<string> {
  return new Set(icuArgumentTypes(message).keys());
}

/** The same arguments with the kind of value each takes, in order of first appearance. */
export function icuArgumentTypes(message: string): Map<string, IcuArgument> {
  const found = new Map<string, IcuArgument>();
  collect(message, found);
  return found;
}

/** Whether a translation uses exactly the arguments its English source does. */
export function sameIcuArguments(source: string, translation: string): boolean {
  const wanted = icuArguments(source);
  const got = icuArguments(translation);
  if (wanted.size !== got.size) return false;
  for (const name of wanted) if (!got.has(name)) return false;
  return true;
}
