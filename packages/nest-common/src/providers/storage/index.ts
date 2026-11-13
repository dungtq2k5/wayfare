// `@wayfare/nest-common/storage` — the media storage adapter, on its own subpath so services that
// store nothing never load `@google-cloud/storage` (conventions §3, ADR 0022).
export * from './gcs.storage-provider';
export * from './storage-provider';
