import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import { TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTourist } from '../src/i18n/use-tourist';
import { Icon } from '../src/theme/icon';
import { Button } from '../src/ui/button';
import { LIST_END_PADDING } from '../src/ui/layout';
import { ScreenHeader } from '../src/ui/screen-header';
import { isXiaomi } from '../src/walk/maker';

type Step = { title: string; how: string };

function Steps({ heading, steps }: { heading: string; steps: Step[] }) {
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="text-body-strong text-foreground">
        {heading}
      </Text>
      {steps.map((step, index) => (
        <View key={step.title} className="flex-row items-start gap-3">
          <View className="h-7 w-7 items-center justify-center rounded-full bg-secondary">
            <Text className="text-label text-secondary-foreground">{index + 1}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-body-strong text-foreground">{step.title}</Text>
            <Text className="text-label text-muted-foreground">{step.how}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** W18 · *Keep Wayfare walking*: this phone's maker first, then the generic steps. */
export default function WalkHelpScreen() {
  const { t } = useTourist();
  const [restricted, setRestricted] = useState(false);
  useEffect(() => {
    Battery.isBatteryOptimizationEnabledAsync()
      .then(setRestricted)
      .catch(() => setRestricted(false));
  }, []);

  const open: Step = { title: t('walk.help.open'), how: t('walk.help.open.how') };
  const hyperos: Step[] = [
    open,
    { title: t('walk.help.battery'), how: t('walk.help.battery.how') },
    { title: t('walk.help.autostart'), how: t('walk.help.autostart.how') },
    { title: t('walk.help.lock'), how: t('walk.help.lock.how') },
  ];
  const others: Step[] = [
    open,
    { title: t('walk.help.unrestricted'), how: t('walk.help.unrestricted.how') },
    { title: t('walk.help.sleeping'), how: t('walk.help.sleeping.how') },
  ];
  const mine = isXiaomi(Device.manufacturer);
  const sections = [
    { key: 'hyperos', heading: t('walk.help.hyperos'), steps: hyperos, mine },
    { key: 'others', heading: t('walk.help.others'), steps: others, mine: !mine },
  ].sort((a, b) => Number(b.mine) - Number(a.mine));

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('walk.help.title')} type="back" />
      <ScrollView
        contentContainerClassName="gap-6 px-4"
        contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}
      >
        <Text className="text-body text-muted-foreground">{t('walk.help.intro')}</Text>
        {restricted && (
          <View className="flex-row items-center gap-2 rounded-lg bg-warning p-3">
            <Icon icon={TriangleAlert} size="md" color="warning-foreground" />
            <Text className="flex-1 text-label text-warning-foreground">
              {t('walk.help.restricted')}
            </Text>
          </View>
        )}
        {sections.map((section) => (
          <Steps
            key={section.key}
            heading={
              section.mine ? `${t('walk.help.thisPhone')} · ${section.heading}` : section.heading
            }
            steps={section.steps}
          />
        ))}
        <Text className="text-caption text-muted-foreground">{t('walk.help.differ')}</Text>
        <Button label={t('walk.help.open')} onPress={() => void Linking.openSettings()} />
      </ScrollView>
    </SafeAreaView>
  );
}
