import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';
import { CheckboxRow } from '../ui/checkbox-row';
import { TextField } from '../ui/text-field';
import { LinkButton } from './components';
import { useFakeGoogle } from './google';

/**
 * Diagnostics' stand-in for Google's chooser (K12): an address, whether Google vouches for it and
 * owns its mailbox, or one of the chooser's failures. Everything after the pick is the real code.
 * Mount once, in the root layout; it shows while a pick is pending.
 */
export function FakeGooglePickerHost() {
  const pending = useFakeGoogle((state) => state.pending);
  if (pending === null) return null;
  return <Picker onChoice={pending} />;
}

function Picker({
  onChoice,
}: {
  onChoice: NonNullable<ReturnType<typeof useFakeGoogle.getState>['pending']>;
}) {
  const { t } = useTourist();
  const [email, setEmail] = useState('');
  const [verified, setVerified] = useState(true);
  const [workspace, setWorkspace] = useState(false);
  const address = email.trim().toLowerCase();

  return (
    <BottomSheet onClose={() => onChoice('cancelled')} closeLabel={t('action.close')}>
      <Text accessibilityRole="header" className="text-heading text-foreground">
        {t('account.fakeGoogle.title')}
      </Text>
      <View className="gap-3">
        <TextField
          testID="fake-google-email"
          label={t('account.field.email')}
          placeholder="mai.nguyen@gmail.com"
          value={email}
          onChangeText={setEmail}
          // A made-up Google account: never the password manager's saved ones.
          autoComplete="off"
          keyboardType="email-address"
        />
        <CheckboxRow
          testID="fake-google-verified"
          label={t('account.fakeGoogle.verified')}
          checked={verified}
          onChange={setVerified}
        />
        <CheckboxRow
          testID="fake-google-workspace"
          label={t('account.fakeGoogle.workspace')}
          checked={workspace}
          onChange={setWorkspace}
        />
        <Button
          testID="fake-google-continue"
          label={t('account.google.continue')}
          disabled={!address.includes('@')}
          onPress={() => onChoice({ email: address, verified, workspace })}
        />
        <View className="flex-row flex-wrap justify-center">
          <LinkButton label={t('account.cancel')} onPress={() => onChoice('cancelled')} />
          <LinkButton
            label={t('account.fakeGoogle.noAccount')}
            onPress={() => onChoice('no-account')}
          />
          <LinkButton
            label={t('account.fakeGoogle.unreachable')}
            onPress={() => onChoice('unreachable')}
          />
        </View>
      </View>
    </BottomSheet>
  );
}
