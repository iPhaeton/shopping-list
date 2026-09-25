import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ErrorBanner } from '../components/ErrorBanner';
import { SegmentedPicker, type SegmentedOption } from '../components/SegmentedPicker';
import type { ThemePreference } from '../lib/themePreference';
import type { AccountScreenProps } from '../navigation/types';
import { useSession } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

const APPEARANCES: SegmentedOption<ThemePreference>[] = [
  { value: 'day', title: 'Day' },
  { value: 'night', title: 'Night' },
];

const appearanceLabel = (preference: ThemePreference) =>
  APPEARANCES.find((option) => option.value === preference)?.title ?? preference;

/**
 * Takes `navigation`/`route` as props per convention even though it never uses them: like
 * `SignInScreen`, a successful sign-out flips the session state and `RootNavigator` swaps stacks,
 * which unmounts this screen rather than navigating away from it.
 */
export function AccountScreen(_props: AccountScreenProps) {
  const styles = useStyles();
  const { colors, scheme, preference, setPreference } = useTheme();
  const { state, signOut, signOutEverywhere, setName } = useSession();

  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingEverywhere, setPendingEverywhere] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [namePending, setNamePending] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Unreachable in practice — RootNavigator only mounts this screen while `signedIn` — but narrows
  // `state.session`/`state.name` for everything below instead of an `!` on each use.
  if (state.status !== 'signedIn') return null;

  const canSaveName = nameDraft.trim().length >= 3 && !namePending;

  function startEditingName() {
    if (state.status !== 'signedIn') return;
    setNameDraft(state.name ?? '');
    setNameError(null);
    setEditingName(true);
  }

  function cancelEditingName() {
    setEditingName(false);
    setNameError(null);
  }

  async function saveName() {
    setNamePending(true);
    setNameError(null);

    const { error: failure, verdict, sessionRevoked } = await setName(nameDraft);

    if (failure) {
      if (sessionRevoked) {
        void signOut('revoked');
        return;
      }
      setNameError(verdict === 'retryable' ? 'You need a connection to change your name.' : failure);
      setNamePending(false);
      return;
    }

    setNamePending(false);
    setEditingName(false);
  }

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
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{state.session.user.email}</Text>
        </View>
      </View>

      <View style={styles.row}>
        {nameError ? <ErrorBanner message={nameError} /> : null}
        {editingName ? (
          <View style={styles.confirm}>
            <TextInput
              style={styles.input}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Your name"
              placeholderTextColor={colors.textMuted}
              keyboardAppearance={scheme}
              selectionColor={colors.primary}
              accessibilityLabel="Your name"
              autoCapitalize="words"
              autoCorrect={false}
              editable={!namePending}
            />
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel editing name"
                accessibilityState={{ disabled: namePending }}
                disabled={namePending}
                onPress={cancelEditingName}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.buttonPressed]}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save name"
                accessibilityState={{ disabled: !canSaveName }}
                disabled={!canSaveName}
                onPress={() => void saveName()}
                style={({ pressed }) => [
                  styles.saveButton,
                  !canSaveName && styles.saveButtonDisabled,
                  pressed && styles.buttonPressed,
                ]}>
                <Text style={styles.saveButtonText}>{namePending ? 'Saving…' : 'Save name'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Name</Text>
            <View style={styles.nameValueRow}>
              <Text style={styles.infoValue}>{state.name ?? 'Not set'}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit name"
                accessibilityState={{ disabled: state.name === null }}
                disabled={state.name === null}
                onPress={startEditingName}
                style={({ pressed }) => [styles.editButton, pressed && styles.buttonPressed]}>
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* Per device, not per account: it applies before sign-in too, and outlives this account. */}
      <View style={styles.row}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Appearance</Text>
          <SegmentedPicker
            options={APPEARANCES}
            value={preference}
            labelFor={appearanceLabel}
            onChange={setPreference}
          />
        </View>
      </View>

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

const useStyles = themedStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.skyTop,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
  },
  button: {
    padding: spacing.lg,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: colors.primary,
  },
  confirm: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  confirmText: {
    fontFamily: fonts.sans,
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
    borderColor: colors.outline,
  },
  cancelButtonText: {
    fontFamily: fonts.sans,
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
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    color: colors.onError,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  infoLabel: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.textMuted,
  },
  infoValue: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.text,
  },
  nameValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  editButtonText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.primary,
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
  saveButton: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  saveButtonDisabled: {
    backgroundColor: colors.primaryDisabled,
  },
  saveButtonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    color: colors.onPrimary,
  },
}));
