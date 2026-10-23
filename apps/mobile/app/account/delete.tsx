import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { CloudOff, Heart, ShieldCheck, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SemanticColor } from '@wayfare/design-tokens/tokens';
import { ApiError } from '@wayfare/api-client';
import { deleteAccount } from '../../src/account/actions';
import type { ItsYou } from '../../src/account/actions';
import { ConfirmWithGoogle } from '../../src/account/google-components';
import { useAccountStore } from '../../src/session/account-store';
import { ErrorBanner, FormBody, LinkButton } from '../../src/account/components';
import { formErrorOf } from '../../src/account/form-errors';
import type { FormError } from '../../src/account/form-errors';
import { deleteWordMatches } from '../../src/account/rules';
import { useSubmit } from '../../src/account/use-form';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { Icon } from '../../src/theme/icon';
import { Button } from '../../src/ui/button';
import { InlineNote } from '../../src/ui/inline-note';
import { ScreenHeader } from '../../src/ui/screen-header';
import { TextField } from '../../src/ui/text-field';
import { showToast } from '../../src/ui/toast';

function Line({
  icon,
  color,
  title,
  body,
}: {
  icon: LucideIcon;
  color: SemanticColor;
  title: string;
  body: string;
}) {
  return (
    <View className="flex-row gap-3">
      <Icon icon={icon} size="md" color={color} />
      <View className="flex-1 gap-1">
        <Text className="text-body-strong text-foreground">{title}</Text>
        <Text className="text-label text-muted-foreground">{body}</Text>
      </View>
    </View>
  );
}

/**
 * *Delete account* (frames A7, A7b, K14): what happens, in three lines; then the current password
 * and the word, typed in the tourist's language. The API's own word is always what is sent.
 */
export default function DeleteAccountScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const { submit, running, offline } = useSubmit();
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const word = t('account.delete.word');
  // A Google-only account confirms with Google where others give a password (frame A7g).
  const googleOnly = useAccountStore((state) => state.user?.signIn?.password === false);
  const [confirmed, setConfirmed] = useState<{ proof: ItsYou; email: string } | null>(null);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const ready =
    (googleOnly ? confirmed !== null : password !== '') && deleteWordMatches(typed, word);

  const erase = () =>
    submit(async () => {
      try {
        await deleteAccount(
          googleOnly && confirmed !== null ? confirmed.proof : { currentPassword: password },
        );
        showToast(t('account.deleted'));
        router.dismissTo('/settings');
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'CONFIRMATION_EXPIRED') {
          setConfirmed(null);
          setConfirmFailed(true);
          return;
        }
        setError(
          formErrorOf('delete', caught, t) ?? { place: 'banner', title: errorMessage(caught) },
        );
      }
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('account.delete')} type="back" />
      <ScrollView keyboardShouldPersistTaps="handled">
        <FormBody>
          {offline && <InlineNote icon={CloudOff} text={t('account.offline.changes')} />}
          <View className="gap-4 rounded-xl bg-card p-4">
            <Line
              icon={Trash2}
              color="destructive"
              title={t('account.delete.gone.title')}
              body={t('account.delete.gone.body')}
            />
            <Line
              icon={Heart}
              color="primary"
              title={t('account.delete.kept.title')}
              body={t('account.delete.kept.body')}
            />
            <Line
              icon={ShieldCheck}
              color="muted-foreground"
              title={t('account.delete.buy.title')}
              body={t('account.delete.buy.body')}
            />
          </View>
          {error?.place === 'banner' && <ErrorBanner title={error.title} />}
          {googleOnly ? (
            <ConfirmWithGoogle
              proof={confirmed}
              onProof={(proof, address) => {
                setConfirmed({ proof, email: address });
                setConfirmFailed(false);
              }}
              failed={confirmFailed}
              onError={(caught) => setError({ place: 'banner', title: errorMessage(caught) })}
            />
          ) : (
            <TextField
              testID="delete-password"
              label={t('account.field.currentPassword')}
              value={password}
              onChangeText={setPassword}
              secure
              showLabel={t('account.password.show')}
              hideLabel={t('account.password.hide')}
              autoComplete="password"
              error={error?.place === 'current' ? error.title : null}
            />
          )}
          <TextField
            testID="delete-word"
            label={t('account.delete.wordLabel', { word })}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            placeholder={word}
            error={
              typed.trim() !== '' && !deleteWordMatches(typed, word)
                ? t('account.error.word', { word })
                : null
            }
          />
          <Button
            testID="delete-submit"
            label={t('account.delete')}
            icon={Trash2}
            variant="destructive"
            onPress={() => void erase()}
            loading={running}
            disabled={offline || !ready}
          />
          <LinkButton label={t('account.cancel')} onPress={() => router.back()} />
        </FormBody>
      </ScrollView>
    </SafeAreaView>
  );
}
