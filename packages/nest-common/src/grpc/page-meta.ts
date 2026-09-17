import type { commonGrpc } from '@wayfare/contracts/grpc';

/** A page list's meta, as the envelope carries it. */
export interface PageMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * The meta of a page-list response. ts-proto types every message field as optional, so a missing
 * meta would read as "0 results"; it is a contract violation instead, and throws.
 */
export function toPageMetaOrThrow(meta: commonGrpc.PageNumberMeta | undefined): PageMeta {
  if (meta === undefined) throw new Error('A page-list response arrived without its meta');
  return { page: meta.page, pageSize: meta.pageSize, total: meta.total };
}
