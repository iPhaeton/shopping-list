import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ErrorBanner } from '../components/ErrorBanner';
import type { AccountScreenProps } from '../navigation/types';
import { useSession } from '../state/SessionContext';
import { colors, radius, spacing } from '../theme';

/**
 * Takes `navigation`/`route` as props per convention even though it never uses them: like
 * `SignInScreen`, a successful sign-out flips the session state and `RootNavigator` swaps stacks,
 * which unmounts this screen rather than navigating away from it.
 */
export function AccountScreen(_props: AccountScreenProps) {
  const { signOut, signOutEverywhere } = useSession();

  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingEverywhere, setPendingEverywhere] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pressSignOut() {
    setPending(true);
    setError(null);

    const { error: failure } = await signOut();

    // On success the navigator swaps stacks and this screen unmounts. On failure the session is
    // still live, so re-enable and let the user try again.
    if (failure) {
      setError(failure);
      setPending(false);
    }
  }

  async function pressConfirmEverywhere() {
    setPendingEverywhere(true);
    setError(null);

    const { error: failure } = await signOutEverywhere();

    if (failure) {
      setError(failure);
      setPendingEverywhere(false);
      setConfirming(false);
    }
  }

  return (
    <View style={styles.container}>
      {error ? <ErrorBanner message={error} /> : null}

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          accessibilityState={{ disabled: pending }}
          disabled={pending}
          onPress={() => void pressSignOut()}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        {!confirming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out of all devices"
            onPress={() => setConfirming(true)}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
            <Text style={styles.buttonText}>Sign out of all devices</Text>
          </Pressable>
        ) : (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>This signs every device out, not just this one.</Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                accessibilityState={{ disabled: pendingEverywhere }}
                disabled={pendingEverywhere}
                onPress={() => setConfirming(false)}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.buttonPressed]}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              {/* The label stays fixed while the visible text toggles during the request, same
                  convention as SignInScreen's "Resend code" countdown. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm sign out of all devices"
                accessibilityState={{ disabled: pendingEverywhere }}
                disabled={pendingEverywhere}
                onPress={() => void pressConfirmEverywhere()}
                style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}>
                <Text style={styles.dangerButtonText}>
                  {pendingEverywhere ? 'Signing out…' : 'Yes, sign out everywhere'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    padding: spacing.lg,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },
  confirm: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  confirmText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: 15,
    color: colors.text,
  },
  dangerButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.error,
  },
  dangerButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onAccent,
  },
});
