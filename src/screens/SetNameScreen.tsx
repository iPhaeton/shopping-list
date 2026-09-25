import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ErrorBanner } from '../components/ErrorBanner';
import type { SetNameScreenProps } from '../navigation/types';
import { useSession } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * The gate a signed-in account with no confirmed name is routed to — see `AuthState`'s
 * `nameRequired` case and `screensFor` in `RootNavigator`. Same shape as `SignInScreen`: a local
 * `PrimaryButton`, theme tokens only, takes `_props` unused because `RootNavigator` swaps this screen
 * away on its own once `setName` succeeds.
 */
export function SetNameScreen(_props: SetNameScreenProps) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const { state, setName, retryName, signOut } = useSession();
  const session = state.status === 'nameRequired' ? state.session : null;

  const [name, setNameDraft] = useState(() => prefillFrom(session));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One retry, only for a gate that arrived unconfirmed (a fetch that failed right after a live
  // sign-in, not a database-confirmed empty name) — closes the case where someone opens an
  // already-named account on a new device offline at that exact instant, before they're asked to
  // type a name that would otherwise overwrite it once the submission lands. Deliberately a single
  // shot on mount, not a poll.
  useEffect(() => {
    if (state.status === 'nameRequired' && !state.confirmed) retryName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return null; // unreachable: RootNavigator only mounts this screen in `nameRequired`

  const canSubmit = name.trim().length >= 3 && !pending;

  async function submit() {
    if (!canSubmit) return;

    setPending(true);
    setError(null);

    const { error: failure, verdict, sessionRevoked } = await setName(name);

    // Only touched on failure: success flips AuthState to signedIn, which unmounts this screen.
    if (failure) {
      if (sessionRevoked) {
        void signOut('revoked');
        return;
      }
      setError(verdict === 'retryable' ? 'You need a connection to set your name.' : failure);
      setPending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>Pick a name</Text>
        <Text style={styles.hint}>Other people in your lists will see this. It has to be unique.</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setNameDraft}
          placeholder="Your name"
          placeholderTextColor={colors.textMuted}
          keyboardAppearance={scheme}
          selectionColor={colors.primary}
          accessibilityLabel="Your name"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />

        <PrimaryButton label="Continue" enabled={canSubmit} onPress={() => void submit()} />

        {error ? <ErrorBanner message={error} /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Google's OAuth claim GoTrue stores at `full_name` — a client-side suggestion only, never seeded
 * into the database (see the migration's own comment on why a collision there would be worse). */
function prefillFrom(session: { user: { user_metadata?: Record<string, unknown> } } | null): string {
  const fullName = session?.user.user_metadata?.full_name;
  return typeof fullName === 'string' ? fullName : '';
}

function PrimaryButton({
  label,
  enabled,
  onPress,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        !enabled && styles.buttonDisabled,
        pressed && enabled && styles.buttonPressed,
      ]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.skyTop,
    padding: spacing.lg,
  },
  card: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.surfaceOutline,
  },
  title: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 24,
    color: colors.text,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.textMuted,
  },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 16,
    // Set, not left to the default: iOS reuses native text inputs, and one that was the code
    // field keeps its letter spacing unless told otherwise. See `codeInput` in `SignInScreen`.
    letterSpacing: 0,
  },
  button: {
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.primaryDisabled,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: colors.onPrimary,
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
  },
}));
