/** An install's platform — rdm-spec I-2 `devices.platform`. */
export enum Platform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  WEB = 'WEB',
}

/** Every `Platform` value, for validation. */
export const PLATFORMS = Object.values(Platform);

/** Upper bound of `devices.app_version` / `os_version` (rdm-spec I-2). */
export const MAX_VERSION_LENGTH = 32;

/** Upper bound of a BCP 47 language code column (rdm-spec §2.3). */
export const MAX_LANGUAGE_CODE_LENGTH = 16;

/** Upper bound of a legal document version string. */
export const MAX_POLICY_VERSION_LENGTH = 32;
