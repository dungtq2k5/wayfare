/**
 * `.proto` files per gRPC package, relative to the contracts package's `proto/` directory.
 * nest-common resolves the directory at runtime; this file stays free of Node APIs.
 */
export const PROTO_FILES = {
  identity: [
    'wayfare/identity/device.proto',
    'wayfare/identity/auth.proto',
    'wayfare/identity/user.proto',
    'wayfare/identity/admin_user.proto',
    'wayfare/identity/role.proto',
    'wayfare/identity/audit.proto',
    'wayfare/identity/password.proto',
    'wayfare/identity/email_change.proto',
    'wayfare/identity/email_webhook.proto',
    'wayfare/identity/notification.proto',
    'wayfare/identity/owner.proto',
  ],
  catalog: [
    'wayfare/catalog/place_types.proto',
    'wayfare/catalog/place_query.proto',
    'wayfare/catalog/place_admin.proto',
    'wayfare/catalog/upload.proto',
    'wayfare/catalog/localization_source.proto',
    'wayfare/catalog/submission.proto',
    'wayfare/catalog/owner_place.proto',
    'wayfare/catalog/taxonomy_admin.proto',
  ],
  narration: ['wayfare/narration/narration.proto', 'wayfare/narration/synthesis_admin.proto'],
  billing: [
    'wayfare/billing/entitlement.proto',
    'wayfare/billing/billing.proto',
    'wayfare/billing/seller.proto',
    'wayfare/billing/billing_webhook.proto',
    'wayfare/billing/billing_admin.proto',
  ],
  health: ['grpc/health/v1/health.proto'],
} as const;

/** The gRPC package names the services serve. */
export const GRPC_PACKAGES = {
  identity: 'wayfare.identity',
  catalog: 'wayfare.catalog',
  narration: 'wayfare.narration',
  billing: 'wayfare.billing',
  health: 'grpc.health.v1',
} as const;
