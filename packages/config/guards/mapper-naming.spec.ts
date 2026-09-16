// Guard: mappers name the foreign side, checked against the real types (conventions §15, §17.4).
// Parsed with the TypeScript AST — prettier splits signatures across lines freely.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile } from './support/repo';

const SHAPE_CONST = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:SELECT|INCLUDE)$/;
const ROW_TYPE = /^[A-Z][A-Za-z0-9]*Row$/;

/** The outcome of checking one mapper file. */
export interface MapperReport {
  readonly problems: string[];
  /** Exported declarations inspected — the vacuity floor counts these. */
  readonly checked: number;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The last identifier of a type reference (`identityGrpc.Platform` → `Platform`), with its qualifier. */
function typeName(
  type: ts.TypeNode | undefined,
): { name: string; qualifier: string | null } | null {
  if (type === undefined || !ts.isTypeReferenceNode(type)) return null;
  const reference = type.typeName;
  if (ts.isIdentifier(reference)) return { name: reference.text, qualifier: null };
  const qualifier = ts.isIdentifier(reference.left)
    ? reference.left.text
    : reference.left.right.text;
  return { name: reference.right.text, qualifier };
}

function checkFunction(
  file: string,
  name: string,
  returnType: ts.TypeNode | undefined,
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
): string[] {
  if (/^to[A-Z]/.test(name)) {
    const target = typeName(returnType);
    if (target === null)
      return [`${file}: ${name} needs an explicit return type naming its target`];
    return name === `to${target.name}`
      ? []
      : [`${file}: ${name} returns ${target.name}; name it to${target.name}`];
  }
  if (/^from[A-Z]/.test(name)) {
    const source = typeName(parameters[0]?.type);
    if (source === null)
      return [`${file}: ${name} needs an explicit first-parameter type naming its source`];
    const expected = source.qualifier?.endsWith('Grpc') ? `Proto${source.name}` : source.name;
    return name === `from${expected}`
      ? []
      : [`${file}: ${name} reads ${source.name}; name it from${expected}`];
  }
  return [`${file}: ${name} is neither to<Target> nor from<Source>`];
}

/** Every naming problem in one mapper file. */
export function checkMapper(file: string, text: string): MapperReport {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  let checked = 0;

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
      problems.push(`${file}: re-exports are not allowed in a mapper`);
      continue;
    }
    if (!isExported(statement)) continue;

    if (ts.isFunctionDeclaration(statement)) {
      checked++;
      problems.push(
        ...checkFunction(
          file,
          statement.name?.text ?? '(anonymous)',
          statement.type,
          statement.parameters,
        ),
      );
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        checked++;
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : '(destructured)';
        const initializer = declaration.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ) {
          problems.push(...checkFunction(file, name, initializer.type, initializer.parameters));
        } else if (!SHAPE_CONST.test(name)) {
          problems.push(
            `${file}: exported const ${name} is not a <ENTITY>_<VIEW>_SELECT / _INCLUDE shape`,
          );
        }
      }
    } else if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      checked++;
      if (!ROW_TYPE.test(statement.name.text)) {
        problems.push(`${file}: exported type ${statement.name.text} is not a <Entity><View>Row`);
      }
    } else {
      checked++;
      problems.push(`${file}: a mapper exports only to…/from… functions, shapes and Row types`);
    }
  }
  return { problems, checked };
}

function corpus(): string[] {
  return listFiles('services/*/src/**/*.mapper.ts');
}

describe('mapper naming', () => {
  it('holds for every mapper', () => {
    expect(corpus().flatMap((file) => checkMapper(file, readRepoFile(file)).problems)).toEqual([]);
  });

  it('reports every kind of violation', () => {
    const cases: [string, string, RegExp][] = [
      [
        'a verb that is not to/from',
        'export function mapUser(row: UserRow): UserResponseDto { return row; }',
        /neither to<Target>/,
      ],
      [
        'to… naming the wrong target',
        'export function toUser(row: UserRow): UserResponseDto { return row; }',
        /name it toUserResponseDto/,
      ],
      [
        'to… without a return type',
        'export function toUserResponseDto(row: UserRow) { return row; }',
        /explicit return type/,
      ],
      [
        'from… missing the Proto prefix',
        'export function fromPlatform(value: identityGrpc.Platform): Platform { return value; }',
        /name it fromProtoPlatform/,
      ],
      [
        'an exported helper constant',
        'export const PLATFORM_TABLE = {};',
        /not a <ENTITY>_<VIEW>_SELECT/,
      ],
      [
        'an arrow const with the wrong target',
        'export const toUserDto = (row: UserRow): UserResponseDto => row;',
        /name it toUserResponseDto/,
      ],
      ['an exported class', 'export class Helpers {}', /exports only/],
      ['a type that is not a Row', 'export type UserShape = {};', /not a <Entity><View>Row/],
    ];
    for (const [label, text, expected] of cases) {
      expect(checkMapper('m.mapper.ts', text).problems.join('\n'), label).toMatch(expected);
    }
  });

  it('accepts the conforming shapes', () => {
    const text = [
      'export function toRegisterDeviceRequest(body: RegisterDeviceDto): identityGrpc.RegisterDeviceRequest { return x; }',
      'export function toRegisterDeviceResponseDto(response: identityGrpc.RegisterDeviceResponse): RegisterDeviceResponseDto { return x; }',
      'export function toRegisterDeviceResponse(id: string, secret: string): identityGrpc.RegisterDeviceResponse { return x; }',
      'export function fromProtoPlatform(value: identityGrpc.Platform): Platform { return x; }',
      'export function toPlaceSummaryResponseDto(',
      '  row: PlaceSummaryRow,',
      '):',
      '  PlaceSummaryResponseDto {',
      '  return x;',
      '}',
      'export const PLACE_SUMMARY_SELECT = { id: true } as const;',
      'export type PlaceSummaryRow = { id: string };',
      'const INTERNAL_TABLE = {};',
    ].join('\n');
    const report = checkMapper('m.mapper.ts', text);
    expect(report.problems).toEqual([]);
    expect(report.checked).toBe(7);
  });

  it('inspects real mapper declarations', () => {
    const files = corpus();
    const checked = files.reduce(
      (sum, file) => sum + checkMapper(file, readRepoFile(file)).checked,
      0,
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
