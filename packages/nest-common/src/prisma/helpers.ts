/**
 * True for Prisma's unique-constraint violation (`P2002`). The index is the enforcement; a
 * pre-check is only the error message (conventions §8.5).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** A value Prisma accepts for a JSONB column. */
export type JsonInput = string | number | boolean | { [key: string]: JsonInput } | JsonInput[];

/** The `outbox_events` row `OutboxService.add` writes (rdm-spec §2.10). */
export interface OutboxEventCreateData {
  id: string;
  subject: string;
  payload: JsonInput;
  aggregateId: string;
  traceParent: string | null;
}

/**
 * The part of a service's `Prisma.TransactionClient` the outbox needs. Structural, because each
 * service generates its own client and nest-common can import none of them.
 */
export interface OutboxTx {
  outboxEvent: {
    create(args: { data: OutboxEventCreateData; select: { id: true } }): PromiseLike<unknown>;
  };
}

/** Raw-SQL access used by the relay and the job recorder — physical column names only. */
export interface RawSqlTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

/** The part of a service's `PrismaService` the relay needs. */
export interface RelayDb extends RawSqlTx {
  $transaction<R>(
    fn: (tx: RawSqlTx) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
}
