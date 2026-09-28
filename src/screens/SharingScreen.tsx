import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { Backdrop } from '../components/Backdrop';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { HorizonFooter } from '../components/HorizonFooter';
import { IconButton } from '../components/IconButton';
import { TrashIcon } from '../components/icons';
import { PillButton } from '../components/PillButton';
import { RolePicker } from '../components/RolePicker';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSky } from '../components/Sky';
import { useKeyboardReveal } from '../components/useKeyboardReveal';
import { UserAutocomplete } from '../components/UserAutocomplete';
import type { Result } from '../lib/listsApi';
import {
  fetchMembers,
  leaveList,
  removeMember,
  setMemberRole,
  shareList,
  type Member,
  type UserSuggestion,
} from '../lib/membersApi';
import type { SharingScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { canManageList } from '../state/roles';
import { useSession } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Role } from '../state/types';
import { fonts, radius, spacing } from '../theme';

/** The wording the `keep_last_owner` trigger raises, so the app and the database agree on one. */
const LAST_OWNER = 'A list must keep at least one owner.';

/** A member's name, falling back to their email for an account that hasn't cleared the name gate
 * yet (pre-migration rows) — never the reverse. */
function displayNameFor(member: Member): string {
  return member.name ?? member.email;
}

/**
 * Who else has access, and — for an owner — how to change it.
 *
 * **The only online-only screen in the app.** The roster comes from an RPC, it is not in `State`, and
 * it is not cached, so there is nothing to show offline and nothing to queue. Its state is local
 * `useState` the way `SignInScreen` holds its phases, and its writes go straight to `listsApi`
 * rather than through the outbox: `shareList` takes an id `UserAutocomplete` already resolved via a
 * search result, so there is nothing left to look up, and the roster it changes has to stay live
 * rather than queued.
 */
export function SharingScreen({ navigation, route }: SharingScreenProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { listId } = route.params;
  const { lists, userId, refresh, lastNudge } = useLists();
  const { signOut } = useSession();
  const list = lists.find((candidate) => candidate.id === listId);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<UserSuggestion | null>(null);
  const [inviteRole, setInviteRole] = useState<Role>('writer');
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingRemoveUserId, setConfirmingRemoveUserId] = useState<string | null>(null);

  // With the keyboard up, the invite field, its suggestions and the Share row — all of it, not just
  // the field — sit above the keyboard. Its bottom edge, in the scroll content's coordinates, is the
  // body's offset plus the invite block's own.
  const reveal = useKeyboardReveal();
  const bodyY = useRef(0);
  const inviteBottom = useRef<number | null>(null);
  const revealInvite = () => {
    if (inviteBottom.current !== null) reveal.setTarget(bodyY.current + inviteBottom.current);
  };

  const load = useCallback(async () => {
    const { members: rows, error: failure } = await fetchMembers(listId);
    if (rows) {
      setMembers(rows);
      return rows;
    }

    setError(failure);
    return null;
  }, [listId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A realtime nudge for this list — someone else joined, left, or changed role — reaches the
  // roster this way rather than through `ListsContext`'s own reducer state, which this screen
  // deliberately isn't part of. `listId === undefined` is a resubscribe or malformed payload, the
  // same "not sure what changed, re-check" case `refreshSoon` treats as `dirty = 'all'`.
  useEffect(() => {
    if (!lastNudge) return;
    if (lastNudge.listId !== undefined && lastNudge.listId !== listId) return;
    void load();
  }, [lastNudge, listId, load]);

  const manageable = list ? canManageList(list.role) : false;
  const owners = members?.filter((member) => member.role === 'owner') ?? [];
  // Disabling your own demote and remove is a courtesy; the trigger is what actually decides, and
  // two clients can race, so its refusal is still rendered when it comes.
  const soleOwner = owners.length === 1 && owners[0].userId === userId;

  /**
   * Every membership write goes through here: disable the controls, send, then either say what went
   * wrong or re-read both the roster and the lists. Returns whether the write went through, which
   * `confirmingLeave` uses to collapse back to the plain "Leave list" button on a refusal — the same
   * shape `AccountScreen`'s `pressConfirmEverywhere` uses for its own confirm row.
   */
  async function run(call: () => Promise<Result>): Promise<boolean> {
    setPending(true);
    setError(null);

    const { error: failure, verdict, sessionRevoked } = await call();

    if (failure) {
      // This device's own session was revoked elsewhere — hand off to the sign-in screen rather than
      // showing a refusal the roster will just repeat on the next attempt. Pending is left as-is,
      // matching `SignInScreen.verifyCode`'s pattern for a path that's about to unmount.
      if (sessionRevoked) {
        void signOut('revoked');
        return false;
      }

      // `verdict` rather than the status: `P0002` — "that account no longer exists" — arrives as a
      // 500 and is classified by its SQLSTATE, so a vanished target does not read as an outage.
      setError(verdict === 'retryable' ? 'You need a connection to change who has access.' : failure);
      setPending(false);
      return false;
    }

    const rows = await load();
    void refresh();
    setPending(false);

    // Removing or demoting yourself is legal for an owner while another owner remains, and so is
    // leaving as a reader/writer. If your own membership is gone, this list is no longer yours to
    // look at.
    if (rows && !rows.some((member) => member.userId === userId)) navigation.popToTop();
    return true;
  }

  if (!list) {
    return (
      <Backdrop art={<ScreenSky />}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title="Sharing" onBack={() => navigation.goBack()} />
          <EmptyState title="List not found" hint="Go back and pick a list from the list screen." />
          <View style={styles.spacer} />
          <HorizonFooter />
        </ScrollView>
      </Backdrop>
    );
  }

  const canInvite = selected !== null && !pending;

  /** Cancel and the one destructive step, under the sentence saying what that step costs. */
  const confirm = (
    sentence: string,
    label: string,
    visibleLabel: string,
    onConfirm: () => void,
    onCancel: () => void
  ) => (
    <View style={styles.confirm}>
      <Text style={styles.confirmText}>{sentence}</Text>
      <View style={styles.confirmActions}>
        <PillButton label="Cancel" size="md" disabled={pending} onPress={onCancel} style={styles.half} />
        {/* The label stays fixed while the visible text toggles during the request, same
            convention as AccountScreen's "Sign out of all devices" confirm. */}
        <PillButton
          label={label}
          visibleLabel={visibleLabel}
          variant="danger"
          size="md"
          disabled={pending}
          onPress={onConfirm}
          style={styles.half}
        />
      </View>
    </View>
  );

  return (
    <Backdrop art={<ScreenSky />}>
      <ScrollView
        ref={reveal.ref}
        onLayout={reveal.onLayout}
        onScroll={reveal.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <ScreenHeader title="Sharing" onBack={() => navigation.goBack()} />

        {error ? <ErrorBanner message={error} /> : null}

        <View
          style={styles.body}
          onLayout={({ nativeEvent: { layout } }) => {
            bodyY.current = layout.y;
            revealInvite();
          }}>
          <Text accessibilityRole="header" style={styles.heading}>
            People with access
          </Text>

          {members === null ? (
            <ActivityIndicator
              accessibilityLabel="Loading who has access"
              color={colors.primary}
              style={styles.loading}
            />
          ) : (
            <View style={styles.members}>
              {members.map((member) => {
                const you = member.userId === userId;
                const locked = pending || (you && soleOwner);
                const name = displayNameFor(member);
                const confirmingRemove = confirmingRemoveUserId === member.userId;

                return (
                  <Card key={member.userId} style={styles.member}>
                    <View style={styles.memberRow}>
                      <Avatar id={member.userId} name={name} />
                      <Text style={styles.name} numberOfLines={1}>
                        {you ? `${name} (you)` : name}
                      </Text>

                      {manageable ? (
                        confirmingRemove ? null : (
                          <IconButton
                            label={`Remove ${displayNameFor(member)}`}
                            fill={colors.controlFill}
                            disabled={locked}
                            onPress={() => setConfirmingRemoveUserId(member.userId)}>
                            <TrashIcon color={colors.text} />
                          </IconButton>
                        )
                      ) : you ? (
                        confirmingLeave ? null : (
                          <PillButton
                            label="Leave list"
                            tone="danger"
                            disabled={pending}
                            onPress={() => setConfirmingLeave(true)}
                          />
                        )
                      ) : (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{member.role}</Text>
                        </View>
                      )}
                    </View>

                    {manageable ? (
                      confirmingRemove ? (
                        confirm(
                          you
                            ? "You'll lose access to this list until someone shares it with you again."
                            : `${name} will lose access to this list until someone shares it with them again.`,
                          `Confirm remove ${displayNameFor(member)}`,
                          pending ? 'Removing…' : 'Remove',
                          () => {
                            // Cleared either way, not just on refusal: on success this member's row
                            // is simply gone next render, but the id would otherwise sit in state
                            // and wrongly re-open the confirm view if the same account is re-invited
                            // later and lands back on the same userId.
                            void run(() => removeMember(listId, member.userId)).then(() => {
                              setConfirmingRemoveUserId(null);
                            });
                          },
                          () => setConfirmingRemoveUserId(null)
                        )
                      ) : (
                        <View style={styles.memberPicker}>
                          <RolePicker
                            value={member.role}
                            labelFor={(role) => `Set ${displayNameFor(member)} to ${role}`}
                            disabled={locked}
                            size="compact"
                            onChange={(role) => void run(() => setMemberRole(listId, member.userId, role))}
                          />
                        </View>
                      )
                    ) : you && confirmingLeave ? (
                      confirm(
                        "You'll lose access to this list until someone shares it with you again.",
                        'Confirm leave list',
                        pending ? 'Leaving…' : 'Leave list',
                        () => {
                          void run(() => leaveList(listId)).then((ok) => {
                            if (!ok) setConfirmingLeave(false);
                          });
                        },
                        () => setConfirmingLeave(false)
                      )
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}

          {manageable && soleOwner ? <Text style={styles.hint}>{LAST_OWNER}</Text> : null}

          {manageable ? (
            <View
              onLayout={({ nativeEvent: { layout } }) => {
                inviteBottom.current = layout.y + layout.height;
                revealInvite();
              }}>
              <Text accessibilityRole="header" style={[styles.heading, styles.inviteHeading]}>
                Invite someone
              </Text>
              <View style={styles.inviteField}>
                <UserAutocomplete
                  value={query}
                  onChangeText={(text) => {
                    setQuery(text);
                    setSelected(null);
                  }}
                  onSelect={(user) => {
                    setSelected(user);
                    setQuery(user.name);
                  }}
                  selected={selected}
                  disabled={pending}
                />
              </View>
              {/* Only once a name is being typed, as the mockups draw it: an empty field has nobody
                  to give a role to. Re-sharing someone who is already a member is an upsert in
                  `share_list`, so this form doubles as a promote and there is nothing extra to
                  build for it. */}
              {query.trim().length > 0 ? (
                <View style={styles.invite}>
                  <View style={styles.invitePicker}>
                    <RolePicker
                      value={inviteRole}
                      labelFor={(role) => `Share as ${role}`}
                      disabled={pending}
                      track="surface"
                      onChange={setInviteRole}
                    />
                  </View>
                  <PillButton
                    label="Share"
                    variant="filled"
                    size="md"
                    disabled={!canInvite}
                    onPress={() => {
                      if (!selected) return;
                      void run(async () => {
                        const result = await shareList(listId, selected.userId, inviteRole);
                        if (!result.error) {
                          setQuery('');
                          setSelected(null);
                        }
                        return result;
                      });
                    }}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.hint}>Only an owner can change who has access.</Text>
          )}
        </View>

        <View style={styles.spacer} />
        <HorizonFooter />
      </ScrollView>
    </Backdrop>
  );
}

// Measured off the three Sharing mockups: cards at x 20–370, 10pt apart, their content 15pt in; a
// 36pt avatar, the name 13pt after it, the remove button at the card's right edge; the role picker
// 10pt below.
const useStyles = themedStyles((colors) => ({
  content: {
    flexGrow: 1,
  },
  body: {
    paddingHorizontal: 20,
  },
  heading: {
    marginTop: 11,
    fontFamily: fonts.serif,
    fontSize: 24,
    lineHeight: 32,
    color: colors.text,
  },
  inviteHeading: {
    marginTop: 16,
  },
  inviteField: {
    marginTop: 8,
  },
  loading: {
    marginTop: spacing.xl,
  },
  members: {
    marginTop: 10,
    gap: 10,
  },
  member: {
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  name: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
  },
  badge: {
    height: 28,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.outline,
    justifyContent: 'center',
  },
  // The node still reads `owner`; only the eye sees `Owner`.
  badgeText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.text,
    textTransform: 'capitalize',
  },
  memberPicker: {
    marginTop: 10,
  },
  hint: {
    marginTop: 10,
    paddingHorizontal: spacing.xs,
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  confirm: {
    marginTop: 10,
  },
  confirmText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 11,
    marginTop: 10,
  },
  half: {
    flex: 1,
  },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 10,
  },
  invitePicker: {
    flex: 1,
  },
  // At least enough that the sun stays below the fold when the page only just fills the screen, as
  // the long owner mockups draw it — the horizon closes the page, it does not crowd its last field.
  spacer: {
    flex: 1,
    minHeight: 64,
  },
}));
