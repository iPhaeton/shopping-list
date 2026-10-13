import { Trans, useLingui } from '@lingui/react/macro';
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
  const { t } = useLingui();
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

  const appearances: SegmentedOption<ThemePreference>[] = [
    {
      value: 'day',
      title: t({
        comment: 'Appearance picker option: the light theme. Fits about 9 characters, one of three equal segments.',
        message: 'Day',
      }),
    },
    {
      value: 'night',
      title: t({
        comment: 'Appearance picker option: the dark theme. Fits about 9 characters, one of three equal segments.',
        message: 'Night',
      }),
    },
    {
      value: 'auto',
      title: t({
        comment:
          'Appearance picker option: switches between the light and dark themes at sunrise and sunset. Fits about 9 characters, one of three equal segments.',
        message: 'Auto',
      }),
    },
  ];
  const appearanceLabel = (choice: ThemePreference) =>
    appearances.find((option) => option.value === choice)?.title ?? choice;
  const saveNameLabel = t({
    comment: 'Button: saves the name being edited. Fits about 12 characters, half of a row of two buttons.',
    message: 'Save name',
  });

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
      setNameError(
        verdict === 'retryable'
          ? t({ comment: 'Shown when saving a new name failed for lack of a connection.', message: 'You need a connection to change your name.' })
          : failure
      );
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

    setDeleteError(
      verdict === 'retryable'
        ? t({ comment: 'Shown when deleting the account failed for lack of a connection.', message: 'You need a connection to delete your account.' })
        : failure
    );
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
        <ScreenHeader
          title={t({ comment: "The Account screen's title, and the label of the button that opens it.", message: 'Account' })}
          onBack={() => navigation.goBack()}
        />

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
                    <Text style={styles.label}>
                      <Trans comment="Label (noun) above the account's email address.">Email</Trans>
                    </Text>
                    <Text style={styles.value}>{email}</Text>
                  </View>
                  {/* A browser without the Web Share API rejects (react-native-web); the press then
                      does nothing rather than throwing unhandled. */}
                  <PillButton
                    label={t({
                      comment: 'VoiceOver only: the Share button beside the email address, which opens the system share sheet.',
                      message: 'Share email address',
                    })}
                    visibleLabel={t({
                      comment: 'Button (verb): shares something through the system share sheet, or opens who a list is shared with. Fits about 10 characters.',
                      message: 'Share',
                    })}
                    onPress={() => void Share.share({ message: email }).catch(() => {})}
                  />
                </View>
                <Text style={[styles.confirmText, styles.relayNote]}>
                  <Trans comment="Under an Apple Hide My Email address. “Sign in with Apple” is Apple's feature: use the name Apple uses in this language.">
                    This address hides your real email. On another iPhone, use Sign in with Apple. On
                    Android or the web, sign in with this address, and Apple forwards the code to your
                    inbox.
                  </Trans>
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>
                  <Trans comment="Label (noun) above the account's email address.">Email</Trans>
                </Text>
                <Text style={styles.value}>{email}</Text>
              </>
            )}

            <View style={styles.divider} />

            {editingName ? (
              <>
                <Text style={styles.label}>
                  <Trans comment="A person's name: the label of a field or a value on screen.">Name</Trans>
                </Text>
                {nameError ? <ErrorBanner message={nameError} style={styles.nameError} /> : null}
                <TextField
                  style={styles.nameField}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder={t({ comment: 'Placeholder and label of the field holding the name other people see for this account.', message: 'Your name' })}
                  accessibilityLabel={t({ comment: 'Placeholder and label of the field holding the name other people see for this account.', message: 'Your name' })}
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!namePending}
                />
                <View style={styles.actions}>
                  <PillButton
                    label={t({ comment: 'VoiceOver only: the Cancel button under the name being edited.', message: 'Cancel editing name' })}
                    visibleLabel={t({ comment: 'Button (verb): closes the confirm or editor without doing anything. Fits about 12 characters, half of a row of two buttons.', message: 'Cancel' })}
                    size="md"
                    disabled={namePending}
                    onPress={cancelEditingName}
                    style={styles.half}
                  />
                  <PillButton
                    label={saveNameLabel}
                    visibleLabel={
                      namePending
                        ? t({ comment: 'The Save name button while the new name is being saved. Fits about 12 characters.', message: 'Saving…' })
                        : saveNameLabel
                    }
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
                  <Text style={styles.label}>
                    <Trans comment="A person's name: the label of a field or a value on screen.">Name</Trans>
                  </Text>
                  <Text style={styles.value}>
                    {state.name ??
                      t({ comment: "Shown in place of the account's name while it has none yet.", message: 'Not set' })}
                  </Text>
                </View>
                <PillButton
                  label={t({ comment: 'VoiceOver only: the Edit button beside the name.', message: 'Edit name' })}
                  visibleLabel={t({
                    comment: 'Button (verb) beside the name: opens it for editing. Fits about 8 characters.',
                    message: 'Edit',
                  })}
                  disabled={state.name === null}
                  onPress={startEditingName}
                />
              </View>
            )}
          </Card>

          {/* Per device, not per account: it applies before sign-in too, and outlives this account. */}
          <Card style={[styles.card, styles.appearanceCard]}>
            <View style={styles.appearanceRow}>
              <Text style={styles.label}>
                <Trans comment="Label (noun) of the picker that chooses the light theme, the dark theme, or Auto.">
                  Appearance
                </Trans>
              </Text>
              {/* Under Auto: when it next switches, which also shows how rough the time-zone sunset is. */}
              {nextChange ? <Text style={styles.label}>{nextChange}</Text> : null}
            </View>
            <View style={styles.picker}>
              <SegmentedPicker
                options={appearances}
                value={preference}
                labelFor={appearanceLabel}
                onChange={setPreference}
              />
            </View>
          </Card>

          {/* Its own card between Appearance and signing out, as the task 28 mockup places it. */}
          <Card style={[styles.card, styles.pillCard]}>
            <PillButton
              label={t({
                comment: 'The Blocked people screen: its title, and the buttons that open it from Account and Notifications.',
                message: 'Blocked people',
              })}
              size="lg"
              onPress={() => navigation.navigate('BlockedPeople')}
            />
          </Card>

          <Card style={[styles.card, styles.pillCard]}>
            <PillButton
              label={t({ comment: 'Button: signs out of this device only. A full-width button.', message: 'Sign out' })}
              size="lg"
              disabled={pending || pendingDelete}
              onPress={() => void pressSignOut()}
            />

            {!confirming ? (
              <PillButton
                label={t({ comment: 'Button: signs out of every device at once. A full-width button.', message: 'Sign out of all devices' })}
                size="lg"
                tone="danger"
                disabled={pendingDelete}
                onPress={openConfirmEverywhere}
              />
            ) : (
              <View>
                <Text style={styles.confirmText}>
                  <Trans comment="The confirm under Sign out of all devices: what it does.">
                    This signs every device out, not just this one.
                  </Trans>
                </Text>
                <View style={styles.actions}>
                  <PillButton
                    label={t({ comment: 'Button (verb): closes the confirm or editor without doing anything. Fits about 12 characters, half of a row of two buttons.', message: 'Cancel' })}
                    size="md"
                    disabled={pendingEverywhere}
                    onPress={() => setConfirming(false)}
                    style={styles.snug}
                  />
                  {/* The label stays fixed while the visible text toggles during the request, same
                      convention as SignInScreen's "Resend code" countdown. */}
                  <PillButton
                    label={t({
                      comment: 'VoiceOver only: the button that confirms signing out of every device.',
                      message: 'Confirm sign out of all devices',
                    })}
                    visibleLabel={
                      pendingEverywhere
                        ? t({ comment: 'The confirm button while every device is being signed out.', message: 'Signing out…' })
                        : t({ comment: 'Button: confirms signing out of every device. Shares a row with Cancel.', message: 'Yes, sign out everywhere' })
                    }
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
                label={t({
                  comment: 'Button: starts deleting the account (a confirm follows). A full-width button.',
                  message: 'Delete account',
                })}
                size="lg"
                tone="danger"
                disabled={pending || pendingEverywhere}
                onPress={openConfirmDelete}
              />
            ) : (
              <View>
                <Text style={styles.confirmText}>
                  <Trans comment="The confirm under Delete account: what deleting costs.">
                    Deleting your account can't be undone. Lists you're the only owner of will be
                    deleted, including for anyone you shared them with. Lists that have another owner
                    will stay with their members.
                  </Trans>
                </Text>
                <View style={styles.actions}>
                  <PillButton
                    label={t({ comment: 'VoiceOver only: the Cancel button under the Delete account confirm.', message: 'Cancel deleting account' })}
                    visibleLabel={t({ comment: 'Button (verb): closes the confirm or editor without doing anything. Fits about 12 characters, half of a row of two buttons.', message: 'Cancel' })}
                    size="md"
                    disabled={pendingDelete}
                    onPress={() => setConfirmingDelete(false)}
                    style={styles.snug}
                  />
                  <PillButton
                    label={t({ comment: 'VoiceOver only: the button that confirms deleting the account.', message: 'Confirm delete account' })}
                    visibleLabel={
                      pendingDelete
                        ? t({ comment: 'The confirm button while the account is being deleted.', message: 'Deleting…' })
                        : t({ comment: 'Button: confirms deleting the account. Shares a row with Cancel.', message: 'Yes, delete my account' })
                    }
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
