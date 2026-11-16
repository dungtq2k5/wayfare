// Guard: every text field in the mobile app shows an example of what goes in it (conventions §12.5).
// The shared `TextField`'s type already asks for one; this also catches a bare `TextInput`, and says
// in one place which fields have none: a password (`secure`) and a typed confirmation (`null`).
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile } from './support/repo';

/** Each `<TextField …/>` or `<TextInput …/>` with neither a placeholder nor `secure`. */
export function bareFields(file: string, text: string): string[] {
  const problems: string[] = [];
  for (const match of text.matchAll(/<(TextField|TextInput)\b([\s\S]*?)\/>/g)) {
    const props = match[2]!;
    if (/\bplaceholder=/.test(props) || /\bsecure\b(?!=\{false\})/.test(props)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    problems.push(`${file}:${line}: ${match[1]}`);
  }
  return problems;
}

describe('mobile placeholders', () => {
  it('every text field names an example, or says it has none', () => {
    const files = listFiles('apps/mobile/app', 'apps/mobile/src').filter(
      (file) =>
        file.endsWith('.tsx') && !file.endsWith('.spec.tsx') && !file.endsWith('text-field.tsx'),
    );
    expect(files.flatMap((file) => bareFields(file, readRepoFile(file)))).toEqual([]);
  });

  it('catches a bare field, and lets an example, a password and a stated none through', () => {
    expect(bareFields('x.tsx', '<TextField label="Name" value={v} />')).toEqual([
      'x.tsx:1: TextField',
    ]);
    expect(bareFields('x.tsx', '<TextInput value={v} />')).toEqual(['x.tsx:1: TextInput']);
    expect(
      bareFields(
        'x.tsx',
        '<TextField placeholder="e.g. Alex" /><TextField secure /><TextField placeholder={null} />',
      ),
    ).toEqual([]);
  });
});
