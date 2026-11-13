import { LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import { useRouter } from 'expo-router';
import { ExternalLink, FileText, ShieldCheck } from 'lucide-react-native';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { acceptTerms, signOut } from '../../src/account/actions';
import { FormBody, LinkButton } from '../../src/account/components';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useAppStore } from '../../src/state/app-store';
import { Icon } from '../../src/theme/icon';
import { Button } from '../../src/ui/button';
import { showToast } from '../../src/ui/toast';

const TERMS_URL = 'https://wayfare.app/terms';
const PRIVACY_URL = 'https://wayfare.app/privacy';

/** "1 September 2026", in the app's language: the documents' versions are their dates. */
function versionDate(lang: string): string {
  const day = new Date(`${LEGAL_DOCUMENT_VERSIONS[LegalDocument.TERMS_OF_SERVICE]}T00:00:00Z`);
  return day.toLocaleDateString(lang === 'en' ? 'en-GB' : lang, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * New terms (frame A10, K16): after sign-in, or when an account call answers
 * `LEGAL_VERSION_OUTDATED`. Accept each outdated document, or sign out — Wayfare keeps working.
 */
export default function TermsScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const lang = useAppStore((state) => state.language) ?? 'en';
  const { submit, running, offline } = useSubmit();
  const date = versionDate(lang);

  const accept = () =>
    submit(async () => {
      try {
        await acceptTerms();
        router.back();
      } catch (error) {
        showToast(errorMessage(error));
      }
    });
  const leave = () =>
    submit(async () => {
      await signOut();
      showToast(t('account.signedOut'));
      router.back();
    });

  const documentRow = (icon: typeof FileText, title: string, url: string) => (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={() => void Linking.openURL(url)}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
    >
      <Icon icon={icon} size="lg" color="muted-foreground" />
      <View className="flex-1">
        <Text className="text-body text-foreground">{title}</Text>
        <Text className="text-caption text-muted-foreground">
          {t('account.terms.updated', { date })}
        </Text>
      </View>
      <Icon icon={ExternalLink} size="md" color="muted-foreground" />
    </Pressable>
  );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView>
        <FormBody>
          <View className="gap-2 pt-8">
            <Text className="text-label text-primary">{t('account.terms.kicker')}</Text>
            <Text accessibilityRole="header" className="text-display text-foreground">
              {t('account.terms.title')}
            </Text>
            <Text className="text-body text-muted-foreground">
              {t('account.terms.body', { date })}
            </Text>
          </View>
          <View className="rounded-xl bg-card">
            {documentRow(FileText, t('settings.terms'), TERMS_URL)}
            {documentRow(ShieldCheck, t('settings.privacyPolicy'), PRIVACY_URL)}
          </View>
          <Button
            testID="terms-accept"
            label={t('account.terms.accept')}
            onPress={() => void accept()}
            loading={running}
            disabled={offline}
          />
          <LinkButton label={t('account.terms.signOut')} onPress={() => void leave()} />
          <Text className="text-center text-caption text-muted-foreground">
            {t('account.terms.note')}
          </Text>
        </FormBody>
      </ScrollView>
    </SafeAreaView>
  );
}
