import { uiBundleStatusProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import type { UiBundleResponse } from '@wayfare/contracts';

/** One bundle on the wire (api-endpoints-plan §4.2). */
export function toGetBundleResponse(answer: UiBundleResponse): narrationGrpc.GetBundleResponse {
  return {
    namespace: answer.namespace,
    locale: answer.locale,
    status: uiBundleStatusProto.toProto(answer.status),
    sourceHash: answer.sourceHash,
    messages: answer.messages,
    failedKeys: [...answer.failedKeys],
    ...(answer.retryAfterMs === null ? {} : { retryAfterMs: answer.retryAfterMs }),
  };
}
