import { dirname, join } from 'node:path';
import type { Options } from '@grpc/proto-loader';
import { PROTO_FILES } from '@wayfare/contracts';

/**
 * The contracts package's `proto/` directory, resolved from the installed package — never a
 * relative path into `src` — so it works from source, from `dist` and inside an image.
 */
export const PROTO_ROOT = join(
  dirname(require.resolve('@wayfare/contracts/package.json')),
  'proto',
);

/**
 * `@grpc/proto-loader` options shared by every server and client. They must match on both ends,
 * and they match ts-proto's generated types: camelCase fields, numeric enums, int64 as strings.
 */
export const GRPC_LOADER_OPTIONS: Options = Object.freeze({
  keepCase: false,
  longs: String,
  enums: Number,
  // Fills defaults for ordinary fields; proto3 `optional` fields stay absent when unset.
  defaults: true,
  // No virtual oneof properties: with them, every `optional` field arrives beside a synthetic
  // `_field` key, which a strict request schema refuses and ts-proto's types do not declare.
  oneofs: false,
  includeDirs: [PROTO_ROOT],
});

/** Absolute paths of the `.proto` files for the given packages. */
export function protoPaths(...packages: (keyof typeof PROTO_FILES)[]): string[] {
  return packages.flatMap((name) => PROTO_FILES[name].map((file) => join(PROTO_ROOT, file)));
}
