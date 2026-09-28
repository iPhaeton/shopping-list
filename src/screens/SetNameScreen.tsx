import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { AuthFrame } from '../components/AuthFrame';
import { ErrorBanner } from '../components/ErrorBanner';
import { PillButton } from '../components/PillButton';
import { TextField } from '../components/TextField';
import type { SetNameScreenProps } from '../navigation/types';
import { useSession } from '../state/SessionContext';
import { themedStyles } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';

/**
 * The gate a signed-in account with no confirmed name is routed to — see `AuthState`'s
 * `nameRequired` case and `screensFor` in `RootNavigator`. Same shape as `SignInScreen` — the same
 * `AuthFrame` card, the land and the rising sun behind it — and takes `_props` unused because
 * `RootNavigator` swaps this screen away on its own once `setName` succeeds.
 */
export function SetNameScreen(_props: SetNameScreenProps) {
  const styles = useStyles();
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
    <AuthFrame>
      <Text style={styles.title}>Pick a name</Text>
      <Text style={styles.hint}>Other people in your lists will see this. It has to be unique.</Text>

      {error ? <ErrorBanner message={error} style={styles.error} /> : null}

      <TextField
        style={styles.field}
        value={name}
        onChangeText={setNameDraft}
        placeholder="Your name"
        accessibilityLabel="Your name"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />

      <PillButton
        label="Continue"
        variant="filled"
        size="lg"
        disabled={!canSubmit}
        onPress={() => void submit()}
        style={styles.action}
      />
    </AuthFrame>
  );
}

/** Google's OAuth claim GoTrue stores at `full_name` — a client-side suggestion only, never seeded
 * into the database (see the migration's own comment on why a collision there would be worse). */
function prefillFrom(session: { user: { user_metadata?: Record<string, unknown> } } | null): string {
  const fullName = session?.user.user_metadata?.full_name;
  return typeof fullName === 'string' ? fullName : '';
}

// The same card as `SignInScreen`'s, measured off the same mockups.
const useStyles = themedStyles((colors) => ({
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 38,
    color: colors.text,
  },
  hint: {
    marginTop: 8,
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  error: {
    marginHorizontal: 0,
    marginTop: spacing.lg,
  },
  field: {
    marginTop: 20,
  },
  action: {
    marginTop: 14,
  },
}));
