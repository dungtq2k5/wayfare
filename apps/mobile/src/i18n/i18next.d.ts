import type en from '@wayfare/i18n/locales/en/tourist.json';

// The English source types every key (`t('nav.setings')` does not compile). Arguments are typed
// by `useTourist()` from the generated map, because i18next reads `{{name}}`, not ICU.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'tourist';
    keySeparator: false;
    nsSeparator: false;
    resources: { tourist: typeof en };
  }
}
