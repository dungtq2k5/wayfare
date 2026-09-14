# 0044 — Permissions are a compile-time artifact; roles are data

**Status:** Accepted · **Date:** 2026-09-14 · **Supersedes:** — · **Superseded by:** —

## Context

The product wants administrators to create roles. It is tempting to let them create permissions too. But a permission only means something if a route checks it, and routes are code. A permission created at runtime is required by nothing, enforced by nothing, and shows up in the role editor as a checkbox that does nothing — worse than absent, because it looks like access control.

## Decision

The permission set is `PERMISSION_CODES` in `packages/contracts`. `@RequirePermission` accepts only members of that union, so a typo is a compile error. The `permissions` table mirrors the array, written by the seeder; codes removed from code are marked retired, never deleted. **No HTTP route creates, renames or deletes a permission.**

Roles are data: admins create them and assign permissions from the catalogue. System roles' grants are code and read-only over HTTP.

## Consequences

- A new permission ships with a deploy, together with the route that checks it.
- The role editor can never offer a permission that does not exist in the running build.
- Adding a permission is five edits in one PR (api-endpoints-plan §11).

## See also

- rdm-spec I-5 · api-endpoints-plan §11
