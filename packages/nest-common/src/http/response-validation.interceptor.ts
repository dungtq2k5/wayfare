import { StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';
import type { z } from 'zod';
import { AppHttpException } from './app-http.exception';
import { Paged } from './paged';

/** The metadata key `@ZodSerializerDto` / `@ZodResponse` from nestjs-zod write. */
export const ZOD_SERIALIZER_DTO_METADATA = 'ZOD_SERIALIZER_DTO_OPTIONS';

type SchemaOrDto = z.ZodType | { schema: z.ZodType };

/**
 * Validates a handler's raw return value against the schema attached with `@ZodResponse`
 * (or `@ZodSerializerDto`), before the envelope wraps it (conventions §5.2).
 *
 * - development and test: a mismatch — including a field the schema does not declare — is a
 *   `500 INTERNAL`, so a mapper leaking a column fails a test;
 * - production: undeclared fields are stripped silently; a value that fails the schema is still a 500.
 */
export class ResponseValidationInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly isProduction: boolean,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const declared = this.reflector.getAllAndOverride<SchemaOrDto | SchemaOrDto[] | undefined>(
      ZOD_SERIALIZER_DTO_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (declared === undefined) return next.handle();
    const isArray = Array.isArray(declared);
    const base = toSchema(isArray ? declared[0]! : declared);
    return next.handle().pipe(map((value: unknown) => this.check(value, base, isArray)));
  }

  private check(value: unknown, schema: z.ZodType, isArray: boolean): unknown {
    if (value instanceof StreamableFile) return value;
    if (value instanceof Paged) {
      // A Paged result is always a list: each item is checked against the declared item schema.
      return rebuildPaged(
        value,
        value.items.map((item) => this.checkOne(item, schema)),
      );
    }
    if (isArray) {
      if (!Array.isArray(value)) this.fail('expected an array');
      return (value as unknown[]).map((item) => this.checkOne(item, schema));
    }
    return this.checkOne(value, schema);
  }

  private checkOne(value: unknown, schema: z.ZodType): unknown {
    const result = schema.safeParse(value);
    if (!result.success) {
      // Even in production a value that cannot be shaped is a bug, answered as 500 INTERNAL.
      this.fail(
        result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`).join('; '),
      );
    }
    if (!this.isProduction) {
      const extra = undeclaredKeys(value, result.data);
      if (extra.length > 0) this.fail(`undeclared response field(s): ${extra.join(', ')}`);
    }
    return result.data;
  }

  private fail(reason: string): never {
    const error = new AppHttpException('INTERNAL');
    // The reason reaches the body outside production only; the filter hides every 5xx message there.
    error.message = `Response failed its schema: ${reason}`;
    throw error;
  }
}

function toSchema(declared: SchemaOrDto): z.ZodType {
  return 'schema' in declared ? declared.schema : declared;
}

function rebuildPaged(page: Paged<unknown>, items: unknown[]): Paged<unknown> {
  return Object.assign(
    Object.create(Object.getPrototypeOf(page) as object) as Paged<unknown>,
    page,
    { items },
  );
}

/** Top-level and nested object keys present in the input but dropped by the schema. */
function undeclaredKeys(input: unknown, output: unknown, prefix = ''): string[] {
  if (!isPlainObject(input) || !isPlainObject(output)) return [];
  const keys: string[] = [];
  for (const key of Object.keys(input)) {
    if (!(key in output)) keys.push(prefix + key);
    else keys.push(...undeclaredKeys(input[key], output[key], `${prefix}${key}.`));
  }
  return keys;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}
