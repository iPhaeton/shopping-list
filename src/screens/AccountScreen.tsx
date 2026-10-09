import { useRef, useState } from 'react';
import { ScrollView, Share, Text, View, type LayoutChangeEvent } from 'react-native';

import { Backdrop } from '../components/Backdrop';
import { Card } from '../components/Card';
import { ErrorBanner } from '../components/ErrorBanner';
import { HorizonFooter } from '../components/HorizonFooter';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { SegmentedPicker, type SegmentedOption } from '../components/SegmentedPicker';
import { ScreenSky } from '../components/Sky';
import { TextField } from '../components/TextField';
import { useScrollReveal } from '../components/useScrollReveal';
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
 * Only Apple issues addresses in this domain: Hide My Email's relay. The test is the address, not an
 * Apple identity on the session, because the same account opened on Android or the web — signed in
 * with the email code — must show the sentence too (task 26, request 4).
 */
const RELAY_DOMAIN = '@privaterelay.appleid.com';

const isRelayAddress = (email: string | undefined): email is string =>
  !!email && email.toLowerCase().endsWith(RELAY_DOMAIN);

/**
 * `navigation` goes back, and on to Blocked people (task 28). Like `SignInScreen`, a successful
 * sign-out — or a deleted account — flips the session state and `RootNavigator` swaps stacks, which
 * unmounts this screen rather than navigating away from it.
 *
 * The two confirms, "Sign out of all devices" and "Delete account", are never open together: opening
 * either closes the other (task 25 step 1). While one of the account-ending requests runs, the others
 * are disabled, so neither a confirm nor its pending text can be closed under a request in flight.
 */
export function AccountScreen({ navigation }: AccountScreenProps) {
  const styles = useStyles();
  const { preference, nextChange, setPreference } = useTheme();
  const { state, signOut, signOutEverywhere, deleteAccount, setName } = useSession();
  const scroll = useScrollReveal();

  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingEverywhere, setPendingEverywhere] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  // In the delete card, not the page-level `error` the sign-outs share: a banner at the top would push
  // the card down and out of view (task 25 step 1).
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Where the cards start in the scroll content, and whether the delete card's next layout is the
  // confirm opening — the one moment it is scrolled into view.
  const cardsTop = useRef(0);
  const revealDelete = useRef(false);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [namePending, setNamePending] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Unreachable in practice — RootNavigator only mounts this screen while `signedIn` — but narrows
  // `state.session`/`state.name` for everything below instead of an `!` on each use.
  if (state.status !== 'signedIn') return null;

  const { email } = state.session.user;
  const relay = isRelayAddress(email);
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

  function openConfirmEverywhere() {
    setConfirmingDelete(false);
    setConfirming(true);
  }

  function openConfirmDelete() {
    setConfirming(false);
    setConfirmingDelete(true);
    revealDelete.current = true;
  }

  // The warning runs to five lines, so on a small phone the open card ends below the fold.
  function onDeleteCardLayout({ nativeEvent: { layout } }: LayoutChangeEvent) {
    if (!revealDelete.current) return;
    revealDelete.current = false;
    scroll.reveal(cardsTop.current + layout.y + layout.height);
  }

  async function pressConfirmDelete() {
    setPendingDelete(true);
    setDeleteError(null);

    const { error: failure, verdict, sessionRevoked } = await deleteAccount();

    // On success the navigator swaps stacks and this screen unmounts, as on sign-out.
    if (!failure) return;

    if (sessionRevoked) {
      void signOut('revoked');
      return;
    }

    setDeleteError(verdict === 'retryable' ? 'You need a connection to delete your account.' : failure);
    setPendingDelete(false);
    setConfirmingDelete(false);
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
        ref={scroll.ref}
        onLayout={scroll.onLayout}
        onScroll={scroll.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <ScreenHeader title="Account" onBack={() => navigation.goBack()} />

        {error ? <ErrorBanner message={error} /> : null}

        <View
          style={styles.cards}
          onLayout={({ nativeEvent: { layout } }) => {
            cardsTop.current = layout.y;
          }}>
          <Card style={styles.card}>
            {relay ? (
              <>
                {/* The address wraps between letters rather than ever being cut off (task 26 step 1). */}
                <View style={styles.nameRow}>
                  <View style={styles.nameText}>
                    <Text style={styles.label}>Email</Text>
                    <Text style={styles.value}>{email}</Text>
                  </View>
                  {/* A browser without the Web Share API rejects (react-native-web); the press then
                      does nothing rather than throwing unhandled. */}
                  <PillButton
                    label="Share email address"
                    visibleLabel="Share"
                    onPress={() => void Share.share({ message: email }).catch(() => {})}
                  />
                </View>
                <Text style={[styles.confirmText, styles.relayNote]}>
                  This address hides your real email. On another iPhone, use Sign in with Apple. On
                  Android or the web, sign in with this address, and Apple forwards the code to your
                  inbox.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>{email}</Text>
              </>
            )}

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

          {/* Its own card between Appearance and signing out, as the task 28 mockup places it. */}
          <Card style={[styles.card, styles.pillCard]}>
            <PillButton
              label="Blocked people"
              size="lg"
              onPress={() => navigation.navigate('BlockedPeople')}
            />
          </Card>

          <Card style={[styles.card, styles.pillCard]}>
            <PillButton
              label="Sign out"
              size="lg"
              disabled={pending || pendingDelete}
              onPress={() => void pressSignOut()}
            />

            {!confirming ? (
              <PillButton
                label="Sign out of all devices"
                size="lg"
                tone="danger"
                disabled={pendingDelete}
                onPress={openConfirmEverywhere}
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

          <Card style={[styles.card, styles.pillCard]} onLayout={onDeleteCardLayout}>
            {deleteError ? <ErrorBanner message={deleteError} style={styles.cardError} /> : null}

            {!confirmingDelete ? (
              <PillButton
                label="Delete account"
                size="lg"
                tone="danger"
                disabled={pending || pendingEverywhere}
                onPress={openConfirmDelete}
              />
            ) : (
              <View>
                <Text style={styles.confirmText}>
                  Deleting your account can't be undone. Lists you're the only owner of will be
                  deleted, including for anyone you shared them with. Lists that have another owner
                  will stay with their members.
                </Text>
                <View style={styles.actions}>
                  <PillButton
                    label="Cancel deleting account"
                    visibleLabel="Cancel"
                    size="md"
                    disabled={pendingDelete}
                    onPress={() => setConfirmingDelete(false)}
                    style={styles.snug}
                  />
                  <PillButton
                    label="Confirm delete account"
                    visibleLabel={pendingDelete ? 'Deleting…' : 'Yes, delete my account'}
                    variant="danger"
                    size="md"
                    disabled={pendingDelete}
                    onPress={() => void pressConfirmDelete()}
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
  // The Blocked people, sign-out and delete cards: lg pills, a confirm opening in place of the
  // danger one.
  pillCard: {
    paddingTop: 18,
    paddingBottom: 20,
    gap: 12,
  },
  // The delete card's failure, above its pill; the card's `gap` spaces it.
  cardError: {
    marginHorizontal: 0,
    marginTop: 0,
  },
  confirmText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  // The hidden-email sentence, in the confirm's type, under the address.
  relayNote: {
    marginTop: 8,
  },
  // As on Sharing: room enough that the sun does not crowd the last card on a page that fills the
  // screen.
  spacer: {
    flex: 1,
    minHeight: 64,
  },
}));
