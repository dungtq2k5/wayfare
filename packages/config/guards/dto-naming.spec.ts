// Guard: DTO classes say what they are (conventions §15, §17.4).
import { basename, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile } from './support/repo';

const CLASS_DECLARATION = /^export class ([A-Za-z0-9_]+)([^{]*)/gm;
const CONST_DECLARATION = /^export const ([A-Za-z0-9_]+)/gm;

/** Every naming problem in one DTO file, as `file: problem`. */
export function checkDtoFile(file: string, text: string): string[] {
  const problems: string[] = [];
  if (basename(dirname(file)) !== 'dto')
    problems.push(`${file}: a DTO file must sit directly inside a dto/ directory`);
  const isResponse = file.endsWith('-response.dto.ts');

  for (const [, name, heritage] of text.matchAll(CLASS_DECLARATION)) {
    if (isResponse && !name!.endsWith('ResponseDto')) {
      problems.push(`${file}: ${name} is in a response file but does not end in ResponseDto`);
    }
    if (!isResponse) {
      if (name!.endsWith('ResponseDto'))
        problems.push(`${file}: ${name} ends in ResponseDto outside a *-response.dto.ts file`);
      else if (!name!.endsWith('Dto')) problems.push(`${file}: ${name} does not end in Dto`);
    }
    if (!/\bextends\s+createZodDto\(/.test(heritage ?? '')) {
      problems.push(`${file}: ${name} does not extend createZodDto(…)`);
    }
  }
  for (const [, name] of text.matchAll(CONST_DECLARATION)) {
    if (!name!.endsWith('Schema'))
      problems.push(`${file}: exported const ${name} does not end in Schema`);
  }
  return problems;
}

function corpus(): string[] {
  return listFiles('services/*/src/**/*.dto.ts');
}

describe('DTO naming', () => {
  it('holds for every DTO file', () => {
    expect(corpus().flatMap((file) => checkDtoFile(file, readRepoFile(file)))).toEqual([]);
  });

  it('reports every kind of violation', () => {
    const extendsZod = 'extends createZodDto(schema) {}';
    const cases: [string, string, string, RegExp][] = [
      [
        'Dto class in a response file',
        'm/dto/a-response.dto.ts',
        `export class ADto ${extendsZod}`,
        /does not end in ResponseDto/,
      ],
      [
        'ResponseDto class in a request file',
        'm/dto/a.dto.ts',
        `export class AResponseDto ${extendsZod}`,
        /outside a \*-response/,
      ],
      [
        'class without Dto',
        'm/dto/a.dto.ts',
        `export class Body ${extendsZod}`,
        /does not end in Dto/,
      ],
      [
        'class not built with createZodDto',
        'm/dto/a.dto.ts',
        'export class ADto {}',
        /createZodDto/,
      ],
      [
        'DTO outside dto/',
        'm/a.dto.ts',
        `export class ADto ${extendsZod}`,
        /directly inside a dto\//,
      ],
      [
        'exported const without Schema',
        'm/dto/a.dto.ts',
        'export const registerBody = z.object({});',
        /does not end in Schema/,
      ],
    ];
    for (const [label, file, text, expected] of cases) {
      expect(checkDtoFile(file, text).join('\n'), label).toMatch(expected);
    }
  });

  it('accepts the conforming shapes', () => {
    const request = [
      'export const registerDeviceBodySchema = z.object({});',
      '// export class OldDto {}',
      'export class RegisterDeviceDto extends createZodDto(registerDeviceBodySchema) {}',
    ].join('\n');
    const response = [
      'export const deviceResponseSchema = z.object({});',
      'export class RegisterDeviceResponseDto extends createZodDto(deviceResponseSchema) {}',
    ].join('\n');
    expect(checkDtoFile('m/dto/device.dto.ts', request)).toEqual([]);
    expect(checkDtoFile('m/dto/device-response.dto.ts', response)).toEqual([]);
  });

  it('scans real DTO files of both kinds', () => {
    const files = corpus();
    expect(files.some((file) => file.endsWith('-response.dto.ts'))).toBe(true);
    expect(files.some((file) => !file.endsWith('-response.dto.ts'))).toBe(true);
    expect(files).toContain('services/gateway/src/modules/devices/dto/device-response.dto.ts');
  });
});
