import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Hillside } from '../components/Hillside';
import { ChevronIcon, CloseIcon, TrashIcon } from '../components/icons';
import { IconButton } from '../components/IconButton';
import { PillButton } from '../components/PillButton';
import { RolePicker } from '../components/RolePicker';
import { HEADER_GAP } from '../components/ScreenHeader';
import { SkyFill } from '../components/Sky';
import { UserAutocomplete } from '../components/UserAutocomplete';
import { ago } from '../lib/ago';
import type { Result } from '../lib/listsApi';
import {
  fetchInvitations,
  fetchMembers,
  inviteToList,
  leaveList,
  removeMember,
  setMemberRole,
  withdrawInvitation,
  type Member,
  type PendingInvitation,
  type UserSuggestion,
} from '../lib/membersApi';
import type { SharingScreenProps } from '../navigation/types';
import { bandAt, contrastRatio } from '../state/bands';
import { useLists } from '../state/ListsContext';
import { canManageList } from '../state/roles';
import { useSession } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Role } from '../state/types';
import { fonts, radius, spacing } from '../theme';

/** The wording the `keep_last_owner` trigger raises, so the app and the database agree on one. */
const LAST_OWNER = 'A list must keep at least one owner.';

/** How far the sky reaches above the header — past any pull-down bounce, as on List detail. */
const OVERSCROLL_SKY = 1000;

/** A member's name, falling back to their email for an account that hasn't cleared the name gate
 * yet (pre-migration rows) — never the reverse. */
function displayNameFor(member: Member): string {
  return member.name ?? member.email;
}

/**
 * Who else has access, and — for an owner — how to change it: invite somebody, withdraw an
 * invitation, change a role, remove a member.
 *
 * **Online-only, like Notifications.** The roster and the open invitations come from RPCs, they are
 * not in `State`, and they are not cached, so there is nothing to show offline and nothing to queue.
 * Their state is local `useState` the way `SignInScreen` holds its phases, and the writes go straight
 * to `membersApi` rather than through the outbox: `inviteToList` takes an id `UserAutocomplete`
 * already resolved via a search result, so there is nothing left to look up, and what it changes has
 * to stay live rather than queued.
 *
 * **Inviting adds nobody** (task 28, D1). The person shows under Invited until they accept — then
 * the roster — or decline, or an owner withdraws, or it expires; a nudge on this list re-reads both.
 *
 * **Laid out as List detail is:** a header pinned over the roster — Back, the title, an owner's
 * invite bar, and the `Hillside` whose hill the roster's land starts from — so inviting is always
 * in reach, however long the roster, and the cards slide up under the hill.
 */
export function SharingScreen({ navigation, route }: SharingScreenProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { listId } = route.params;
  const { lists, userId, refresh, lastNudge } = useLists();
  const { signOut } = useSession();
  const list = lists.find((candidate) => candidate.id === listId);

  const [members, setMembers] = useState<Member[] | null>(null);
  // An owner's view only: the database answers anyone else with an empty list.
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<UserSuggestion | null>(null);
  const [inviteRole, setInviteRole] = useState<Role>('writer');
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingRemoveUserId, setConfirmingRemoveUserId] = useState<string | null>(null);
  const [confirmingWithdrawId, setConfirmingWithdrawId] = useState<string | null>(null);
  // How tall the header's sky is, so the status-bar strip draws the same slice of it.
  const [skyHeight, setSkyHeight] = useState(224);

  // The roster and the invitations, read together, since one change can move somebody from one to
  // the other. Resolves to the roster, which `run` checks for your own row.
  const load = useCallback(async () => {
    const [roster, invited] = await Promise.all([fetchMembers(listId), fetchInvitations(listId)]);
    if (invited.invitations) setInvitations(invited.invitations);

    if (roster.members) {
      setMembers(roster.members);
      if (!invited.invitations) setError(invited.error);
      return roster.members;
    }

    setError(roster.error);
    return null;
  }, [listId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A realtime nudge for this list — someone joined, left, changed role, or was invited, or an
  // invitation was answered or withdrawn — reaches the roster and the invitations this way rather
  // than through `ListsContext`'s own reducer state, which this screen deliberately isn't part of.
  // `listId === undefined` is a resubscribe or malformed payload, the same "not sure what changed,
  // re-check" case `refreshSoon` treats as `dirty = 'all'`.
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

  const canInvite = selected !== null && !pending;
  // When `Invited …` is measured from. The ages move on at the next read, not by the minute.
  const now = Date.now();

  // A refusal — they are already a member, or already invited — is shown in the database's words,
  // through `run`.
  function invite() {
    if (!selected) return;
    void run(async () => {
      const result = await inviteToList(listId, selected.userId, inviteRole);
      if (!result.error) {
        setQuery('');
        setSelected(null);
      }
      return result;
    });
  }

  // The land the roster lies on: band 0, the colour of the hill the header ends in, so a card
  // scrolling up slides under that hill with no seam. The hints lie on it too, and `textSecondary`
  // falls short of AA on it by night — so the band's own ink there.
  const ground = bandAt(colors, 0);
  const hintColor =
    contrastRatio(colors.textSecondary, ground.color) >= 4.5 ? colors.textSecondary : ground.ink;

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

  // Pinned, and opaque top to bottom, as List detail's header is and for the same reasons
  // (ai/kb/entries/list-headers-are-pinned-and-opaque.md): `SkyFill` behind the padded block,
  // `Hillside`'s own sky under the hill, the `skyHorizon` fill under both, and sky above it for a
  // pull-down bounce. An error pins itself above the list instead, taking the safe-area inset.
  const header = (
    <View style={styles.header}>
      <View
        style={styles.overscrollSky}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {/* Raised over `Hillside`, its later sibling: the invite suggestions hang out of this block
          and over the strip. */}
      <View
        style={[styles.top, { paddingTop: (error ? 0 : insets.top) + HEADER_GAP }]}
        onLayout={({ nativeEvent: { layout } }) => {
          if (layout.height !== skyHeight) setSkyHeight(layout.height);
        }}>
        <View
          style={styles.fill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <SkyFill />
        </View>

        <View style={styles.headerRow}>
          <IconButton label="Back" outline={colors.outline} onPress={() => navigation.goBack()}>
            <ChevronIcon direction="left" color={colors.text} size={18} />
          </IconButton>
        </View>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
          Sharing
        </Text>

        {/* Where List detail puts its Add bar. */}
        {manageable ? (
          <View style={styles.slot}>
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
              canInvite={canInvite}
              onInvite={invite}
              listId={listId}
              disabled={pending}
            />
          </View>
        ) : null}
      </View>

      {/* The role, where List detail keeps Show deleted — only once somebody is picked. Before that
          there is nobody to give it to, and the open suggestions hang over this spot: under their
          blur, a checked segment smears into a dark blot. The role picked survives it hiding. */}
      <Hillside ground={ground.color}>
        {selected ? (
          <View style={styles.invitePicker}>
            <RolePicker
              value={inviteRole}
              labelFor={(role) => `Invite as ${role}`}
              disabled={pending}
              track="surface"
              size="small"
              onChange={setInviteRole}
            />
          </View>
        ) : null}
      </Hillside>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: ground.color }]}>
      {error ? (
        <View style={[styles.pinned, { paddingTop: insets.top }]}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          // The header is child 0.
          stickyHeaderIndices={[0]}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          keyboardShouldPersistTaps="handled">
          {header}

          {!list ? (
            <EmptyState
              title="List not found"
              hint="Go back and pick a list from the list screen."
              ink={ground.ink}
            />
          ) : (
            <View style={styles.body}>
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
                                ? "You'll lose access to this list until someone invites you again."
                                : `${name} will lose access to this list until someone invites them again.`,
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
                            "You'll lose access to this list until someone invites you again.",
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

              {manageable && soleOwner ? (
                <Text style={[styles.hint, { color: hintColor }]}>{LAST_OWNER}</Text>
              ) : null}
              {manageable ? null : (
                <Text style={[styles.hint, { color: hintColor }]}>
                  Only an owner can change who has access.
                </Text>
              )}

              {/* Owners only, and only while somebody is invited. Withdrawing opens the same confirm
                  as removing, in place of the button. */}
              {manageable && invitations.length > 0 ? (
                <>
                  <Text accessibilityRole="header" style={[styles.heading, styles.invitedHeading]}>
                    Invited
                  </Text>
                  <View style={styles.members}>
                    {invitations.map((invitation) => {
                      const confirmingWithdraw = confirmingWithdrawId === invitation.invitationId;

                      return (
                        <Card key={invitation.invitationId} style={styles.member}>
                          <View style={styles.memberRow}>
                            <Avatar id={invitation.userId} name={invitation.name} />
                            <View style={styles.invitedText}>
                              <Text style={styles.invitedName} numberOfLines={1}>
                                {invitation.name}
                              </Text>
                              <Text style={styles.invitedAge}>
                                {`Invited ${ago(invitation.createdAt, now)}`}
                              </Text>
                            </View>
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>{invitation.role}</Text>
                            </View>
                            {confirmingWithdraw ? null : (
                              <IconButton
                                label={`Withdraw ${invitation.name}'s invitation`}
                                fill={colors.controlFill}
                                disabled={pending}
                                onPress={() => setConfirmingWithdrawId(invitation.invitationId)}>
                                <CloseIcon color={colors.text} size={16} />
                              </IconButton>
                            )}
                          </View>

                          {confirmingWithdraw
                            ? confirm(
                                `${invitation.name}'s invitation will be withdrawn.`,
                                `Confirm withdraw ${invitation.name}'s invitation`,
                                pending ? 'Withdrawing…' : 'Withdraw',
                                () => {
                                  // Cleared either way, as a removal's confirm is.
                                  void run(() => withdrawInvitation(invitation.invitationId)).then(() => {
                                    setConfirmingWithdrawId(null);
                                  });
                                },
                                () => setConfirmingWithdrawId(null)
                              )
                            : null}
                        </Card>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/*
        Keeps the status bar on clean sky. iOS draws a light blur over the top of this screen's
        scroll view, stars and all, as it does over List detail's list and never over Lists' — the
        same unexplained blur, and the same cure: sky drawn above the scroll view, not inside it.
      */}
      <View
        style={[styles.statusBarSky, { height: insets.top }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <View style={{ height: skyHeight }}>
          <SkyFill initialHeight={skyHeight} />
        </View>
      </View>
    </View>
  );
}

// Measured off the Sharing mockups: the header as List detail's; cards at x 20–370, 10pt apart,
// their content 15pt in; a 36pt avatar, the name 13pt after it, the remove button at the card's
// right edge; the role picker 10pt below.
const useStyles = themedStyles((colors) => ({
  screen: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  pinned: {
    paddingBottom: spacing.sm,
    backgroundColor: colors.skyTop,
  },
  // `SkyFill` ends on `skyHorizon` and `Hillside` starts on it, so a gap between them vanishes.
  header: {
    backgroundColor: colors.skyHorizon,
  },
  overscrollSky: {
    position: 'absolute',
    top: -OVERSCROLL_SKY,
    left: 0,
    right: 0,
    height: OVERSCROLL_SKY,
    backgroundColor: colors.skyTop,
  },
  top: {
    zIndex: 1,
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  headerRow: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    marginTop: 10,
    paddingHorizontal: 20,
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 52,
    color: colors.text,
  },
  statusBarSky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  // With the title's 10 above it, the bar sits where List detail's Add bar does.
  slot: {
    marginTop: 14,
  },
  // Level with List detail's Show deleted track, and clear of the birds to the sun's left.
  invitePicker: {
    marginLeft: 20,
    marginTop: 1,
    width: 204,
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
  // The Invited section, 24 under the hint or the last card, as the step-2 mockup draws it.
  invitedHeading: {
    marginTop: 24,
  },
  invitedText: {
    flex: 1,
  },
  // No `flex`, unlike `name`: in this column a basis of 0 would be a height of 0.
  invitedName: {
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.text,
  },
  invitedAge: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  // Its colour is the screen's: `hintColor`, picked against the land.
  hint: {
    marginTop: 10,
    paddingHorizontal: spacing.xs,
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 22,
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
}));
