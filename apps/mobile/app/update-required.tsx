import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../src/state/app-store';

/** Shown for `426 APP_VERSION_UNSUPPORTED`: this build is below the gateway's floor. */
export default function UpdateRequiredScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const minimumVersion = useAppStore((state) => state.updateRequired);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Text accessibilityRole="header" className="p-6 text-3xl font-bold text-emerald-900">
        {t('updateRequired.title')}
      </Text>
      <Text className="px-6 text-base leading-6 text-slate-800">
        {t('updateRequired.body', { minimumVersion: minimumVersion ?? '' })}
      </Text>
    </SafeAreaView>
  );
}
