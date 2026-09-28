import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Backdrop } from '../components/Backdrop';
import { Card } from '../components/Card';
import { ErrorBanner } from '../components/ErrorBanner';
import { HorizonFooter } from '../components/HorizonFooter';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { SegmentedPicker, type SegmentedOption } from '../components/SegmentedPicker';
import { ScreenSky } from '../components/Sky';
import { TextField } from '../components/TextField';
import type { ThemePreference } from '../lib/themePreference';
import type { AccountScreenProps } from '../navigation/types';
import { useSession } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';

const APPEARANCES: SegmentedOption<ThemePreference>[] = [
  { value: 'day', title: 'Day' },
  { value: 'night', title: 'Night' },
  { value: 'auto', title: 'Auto' },
];

const appearanceLabel = (preference: ThemePreference) =>
  APPEARANCES.find((option) => option.value === preference)?.title ?? preference;

/**
 * `navigation` only goes back: like `SignInScreen`, a successful sign-out flips the session state and
 * `RootNavigator` swaps stacks, which unmounts this screen rather than navigating away from it.
 */
export function AccountScreen({ navigation }: AccountScreenProps) {
  const styles = useStyles();
  const { preference, nextChange, setPreference } = useTheme();
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
    <Backdrop art={<ScreenSky />}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <ScreenHeader title="Account" onBack={() => navigation.goBack()} />

        {error ? <ErrorBanner message={error} /> : null}

        <View style={styles.cards}>
          <Card style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{state.session.user.email}</Text>

            <View style={styles.divider} />

            {editingName ? (
              <>
                <Text style={styles.label}>Name</Text>
                {nameError ? <ErrorBanner message={nameError} style={styles.nameError} /> : null}
                <TextField
                  style={styles.nameField}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Your name"
                  accessibilityLabel="Your name"
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!namePending}
                />
                <View style={styles.actions}>
                  <PillButton
                    label="Cancel editing name"
                    visibleLabel="Cancel"
                    size="md"
                    disabled={namePending}
                    onPress={cancelEditingName}
                    style={styles.half}
                  />
                  <PillButton
                    label="Save name"
                    visibleLabel={namePending ? 'Saving…' : 'Save name'}
                    variant="filled"
                    size="md"
                    disabled={!canSaveName}
                    onPress={() => void saveName()}
                    style={styles.half}
                  />
                </View>
              </>
            ) : (
              <View style={styles.nameRow}>
                <View style={styles.nameText}>
                  <Text style={styles.label}>Name</Text>
                  <Text style={styles.value}>{state.name ?? 'Not set'}</Text>
                </View>
                <PillButton
                  label="Edit name"
                  visibleLabel="Edit"
                  disabled={state.name === null}
                  onPress={startEditingName}
                />
              </View>
            )}
          </Card>

          {/* Per device, not per account: it applies before sign-in too, and outlives this account. */}
          <Card style={[styles.card, styles.appearanceCard]}>
            <View style={styles.appearanceRow}>
              <Text style={styles.label}>Appearance</Text>
              {/* Under Auto: when it next switches, which also shows how rough the time-zone sunset is. */}
              {nextChange ? <Text style={styles.label}>{nextChange}</Text> : null}
            </View>
            <View style={styles.picker}>
              <SegmentedPicker
                options={APPEARANCES}
                value={preference}
                labelFor={appearanceLabel}
                onChange={setPreference}
              />
            </View>
          </Card>

          <Card style={[styles.card, styles.signOutCard]}>
            <PillButton
              label="Sign out"
              size="lg"
              disabled={pending}
              onPress={() => void pressSignOut()}
            />

            {!confirming ? (
              <PillButton
                label="Sign out of all devices"
                size="lg"
                tone="danger"
                onPress={() => setConfirming(true)}
              />
            ) : (
              <View>
                <Text style={styles.confirmText}>This signs every device out, not just this one.</Text>
                <View style={styles.actions}>
                  <PillButton
                    label="Cancel"
                    size="md"
                    disabled={pendingEverywhere}
                    onPress={() => setConfirming(false)}
                    style={styles.snug}
                  />
                  {/* The label stays fixed while the visible text toggles during the request, same
                      convention as SignInScreen's "Resend code" countdown. */}
                  <PillButton
                    label="Confirm sign out of all devices"
                    visibleLabel={pendingEverywhere ? 'Signing out…' : 'Yes, sign out everywhere'}
                    variant="danger"
                    size="md"
                    disabled={pendingEverywhere}
                    onPress={() => void pressConfirmEverywhere()}
                    style={styles.rest}
                  />
                </View>
              </View>
            )}
          </Card>
        </View>

        <View style={styles.spacer} />
        <HorizonFooter />
      </ScrollView>
    </Backdrop>
  );
}

// Measured off the Account mockups: cards at x 20–370, 10pt apart, content 21pt in from their
// edges; the first card's top at y 172, under the title.
const useStyles = themedStyles((colors) => ({
  content: {
    flexGrow: 1,
  },
  cards: {
    marginTop: 12,
    paddingHorizontal: 20,
    gap: 10,
  },
  card: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
  },
  label: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  value: {
    marginTop: 2,
    fontFamily: fonts.sans,
    fontSize: 17,
    lineHeight: 23,
    color: colors.text,
  },
  divider: {
    height: 1,
    marginVertical: 14,
    backgroundColor: colors.divider,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  nameText: {
    flex: 1,
  },
  nameError: {
    marginHorizontal: 0,
    marginTop: 10,
  },
  nameField: {
    height: 48,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  half: {
    flex: 1,
  },
  // The long label takes whatever Cancel leaves, both on tighter sides than a pill usually has — the
  // mockup's 86pt Cancel and 208pt for a 182pt label.
  snug: {
    paddingHorizontal: 18,
  },
  rest: {
    flex: 1,
    paddingHorizontal: 12,
  },
  appearanceCard: {
    paddingTop: 17,
    paddingBottom: 21,
  },
  appearanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  picker: {
    marginTop: 13,
  },
  signOutCard: {
    paddingTop: 18,
    paddingBottom: 20,
    gap: 12,
  },
  confirmText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  // As on Sharing: room enough that the sun does not crowd the last card on a page that fills the
  // screen.
  spacer: {
    flex: 1,
    minHeight: 64,
  },
}));
