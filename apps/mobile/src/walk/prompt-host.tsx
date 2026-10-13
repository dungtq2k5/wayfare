import type { LucideIcon } from 'lucide-react-native';
import { Footprints, Settings, ShieldCheck, WifiOff } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { Button } from '../ui/button';
import { LogoMark } from '../ui/logo-mark';
import { AndroidOptions } from './android-options';
import type { PermissionScreen } from './permissions';
import { usePrompt } from './prompt';

interface Explainer {
  title: string;
  body: string;
  bullets: { icon: LucideIcon; text: string }[];
  primary: string;
  secondary: string;
  footnote?: string;
}

function useExplainer(screen: Exclude<PermissionScreen, 'settings-step'>): Explainer {
  const { t } = useTourist();
  switch (screen) {
    case 'background-explainer':
      return {
        title: t('walk.explainer.background.title'),
        body: t('walk.explainer.background.body'),
        bullets: [
          { icon: ShieldCheck, text: t('walk.explainer.background.private') },
          { icon: Footprints, text: t('walk.explainer.background.listens') },
          { icon: Settings, text: t('walk.explainer.background.change') },
        ],
        primary: t('walk.explainer.continue'),
        secondary: t('walk.explainer.onlyOpen'),
        footnote: t('walk.explainer.background.footnote'),
      };
    case 'notifications-explainer':
      return {
        title: t('walk.explainer.notifications.title'),
        body: t('walk.explainer.notifications.body'),
        bullets: [
          { icon: ShieldCheck, text: t('walk.explainer.notifications.nothingElse') },
          { icon: WifiOff, text: t('walk.explainer.notifications.refuse') },
        ],
        primary: t('walk.explainer.continue'),
        secondary: t('walk.explainer.notNow'),
        footnote: t('walk.explainer.notifications.footnote'),
      };
    case 'location-denied':
      return {
        title: t('walk.denied.title'),
        body: t('walk.denied.body'),
        bullets: [{ icon: ShieldCheck, text: t('walk.explainer.background.private') }],
        primary: t('walk.denied.tryAgain'),
        secondary: t('walk.explainer.notNow'),
      };
    case 'location-denied-forever':
      return {
        title: t('walk.denied.title'),
        body: t('walk.denied.forever'),
        bullets: [{ icon: ShieldCheck, text: t('walk.explainer.background.private') }],
        primary: t('walk.denied.openSettings'),
        secondary: t('walk.explainer.notNow'),
      };
  }
}

function ExplainerScreen({
  screen,
  answer,
}: {
  screen: Exclude<PermissionScreen, 'settings-step'>;
  answer: (answer: 'primary' | 'secondary') => void;
}) {
  const content = useExplainer(screen);
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="grow gap-6 px-6 pt-16">
        <View className="items-center">
          <View className="h-40 w-40 items-center justify-center rounded-full bg-accent">
            <LogoMark size={96} />
          </View>
        </View>
        <Text accessibilityRole="header" className="text-display text-foreground">
          {content.title}
        </Text>
        <Text className="text-body text-muted-foreground">{content.body}</Text>
        <View className="gap-4">
          {content.bullets.map((bullet) => (
            <View key={bullet.text} className="flex-row items-center gap-3">
              <Icon icon={bullet.icon} size="lg" color="muted-foreground" />
              <Text className="flex-1 text-body text-foreground">{bullet.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View className="gap-2 px-6 pb-8">
        <Button label={content.primary} onPress={() => answer('primary')} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={content.secondary}
          onPress={() => answer('secondary')}
          className="min-h-12 items-center justify-center"
        >
          <Text className="text-label text-primary">{content.secondary}</Text>
        </Pressable>
        {content.footnote !== undefined && (
          <Text className="text-center text-caption text-muted-foreground">{content.footnote}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

function SettingsStep({ answer }: { answer: (answer: 'primary' | 'secondary') => void }) {
  const { t } = useTourist();
  return (
    <View className="flex-1 justify-end bg-overlay/50">
      <View className="gap-3 rounded-t-3xl bg-background px-6 pb-6 pt-4">
        <View className="h-1 w-10 self-center rounded-full bg-border" />
        <Text accessibilityRole="header" className="text-title text-foreground">
          {t('walk.step.title')}
        </Text>
        <Text className="text-body text-muted-foreground">{t('walk.step.intro')}</Text>
        <AndroidOptions />
        <Text className="text-label text-muted-foreground">{t('walk.step.back')}</Text>
        <Button label={t('walk.step.open')} onPress={() => answer('primary')} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('walk.explainer.onlyOpen')}
          onPress={() => answer('secondary')}
          className="min-h-12 items-center justify-center"
        >
          <Text className="text-label text-primary">{t('walk.explainer.onlyOpen')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The start flow's screens (W2–W5b), shown over whatever the tourist is looking at. Mount once. */
export function WalkPromptHost() {
  const prompt = usePrompt((state) => state.prompt);
  return (
    <Modal
      visible={prompt !== null}
      animationType="fade"
      transparent={prompt?.screen === 'settings-step'}
      statusBarTranslucent
      onRequestClose={() => prompt?.answer('secondary')}
    >
      {prompt !== null && prompt.screen === 'settings-step' && (
        <SettingsStep answer={prompt.answer} />
      )}
      {prompt !== null && prompt.screen !== 'settings-step' && (
        <ExplainerScreen screen={prompt.screen} answer={prompt.answer} />
      )}
    </Modal>
  );
}
