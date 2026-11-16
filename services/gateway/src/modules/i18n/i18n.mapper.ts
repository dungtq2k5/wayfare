import { UiBundleStatus, zUiBundleResponse } from '@wayfare/contracts';
import type { UiBundleNamespace, UiBundleResponse } from '@wayfare/contracts';
import { uiBundleStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';

/** A bundle's state; an unknown value is a narration newer than this gateway. */
function statusOf(value: number): UiBundleResponse['status'] {
  const parsed = uiBundleStatusProto.fromProto(value);
  if (parsed === null) throw new Error(`narration sent an unknown bundle status: ${value}`);
  if (parsed === UiBundleStatus.FAILED) {
    throw new Error('narration sent a FAILED bundle, which is never served');
  }
  return parsed;
}

/** One bundle as the apps read it. */
export function toUiBundleResponse(response: narrationGrpc.GetBundleResponse): UiBundleResponse {
  return zUiBundleResponse.parse({
    namespace: response.namespace as UiBundleNamespace,
    locale: response.locale,
    status: statusOf(response.status),
    sourceHash: response.sourceHash,
    messages: response.messages,
    failedKeys: response.failedKeys,
    retryAfterMs: response.retryAfterMs ?? null,
  });
}
