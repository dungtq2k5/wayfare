import { useTranslation } from 'react-i18next';
import { touristFrom } from './tourist';
import type { Tourist } from './tourist';

/** The app's only way to translate in a component (keys and ICU arguments are type-checked). */
export function useTourist(): Tourist {
  const { i18n } = useTranslation();
  return touristFrom(i18n);
}
