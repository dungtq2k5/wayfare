import { ActionTokenPurpose } from '@wayfare/contracts';
import { actionTokenPurposeProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import type { ResetLinkResponseDto } from './dto/password-response.dto';

/** A live reset or setup link. Any other purpose is a server fault. */
export function toResetLinkResponseDto(
  response: identityGrpc.ValidateResetTokenResponse,
): ResetLinkResponseDto {
  const purpose = actionTokenPurposeProto.fromProto(response.purpose);
  if (
    purpose !== ActionTokenPurpose.PASSWORD_RESET &&
    purpose !== ActionTokenPurpose.ACCOUNT_SETUP
  ) {
    throw new Error('A reset link validated with an unexpected purpose');
  }
  return { valid: true, purpose, emailMasked: response.emailMasked };
}
