import { icuArgumentTypes } from './icu-arguments';
import type { IcuArgument } from './icu-arguments';

/** The TypeScript type of the value an ICU argument takes. */
export function argumentType(argument: IcuArgument): string {
  switch (argument.kind) {
    case 'number':
    case 'plural':
    case 'selectordinal':
      return 'number';
    case 'date':
    case 'time':
      return 'Date | number';
    case 'select': {
      const choices = argument.options.filter((option) => option !== 'other');
      const open = argument.options.includes('other') || choices.length === 0;
      return [...choices.map((choice) => JSON.stringify(choice)), ...(open ? ['string'] : [])].join(
        ' | ',
      );
    }
    case 'plain':
      return 'string | number';
  }
}

/**
 * The source of a module that types a UI namespace's arguments: for each message that has ICU
 * arguments, the object a caller must pass. A message without arguments is absent, so a call
 * that passes some is a type error.
 */
export function renderArgumentTypes(
  interfaceName: string,
  messages: Readonly<Record<string, string>>,
  regenerate: string,
): string {
  const entries = Object.entries(messages).flatMap(([key, message]) => {
    const args = [...icuArgumentTypes(message)];
    if (args.length === 0) return [];
    const fields = args.map(
      ([name, argument]) => `${JSON.stringify(name)}: ${argumentType(argument)}`,
    );
    return [`  readonly ${JSON.stringify(key)}: { ${fields.join('; ')} };`];
  });
  return [
    `// Written by \`${regenerate}\` from the English source. Do not edit manually.`,
    `export interface ${interfaceName} {`,
    ...entries,
    '}',
    '',
  ].join('\n');
}
