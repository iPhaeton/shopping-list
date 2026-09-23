import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { RolePicker } from '../components/RolePicker';
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
import type { Role } from '../state/types';
import { colors, radius, spacing } from '../theme';

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
      <View style={styles.container}>
        <EmptyState title="List not found" hint="Go back and pick a list from the list screen." />
      </View>
    );
  }

  const canInvite = selected !== null && !pending;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error ? <ErrorBanner message={error} /> : null}

      <Text style={styles.heading}>People with access</Text>

      {members === null ? (
        <ActivityIndicator accessibilityLabel="Loading who has access" color={colors.accent} />
      ) : (
        members.map((member) => {
          const you = member.userId === userId;
          const locked = pending || (you && soleOwner);

          return (
            <View key={member.userId} style={styles.member}>
              <Text style={styles.email}>
                {you ? `${displayNameFor(member)} (you)` : displayNameFor(member)}
              </Text>

              {manageable ? (
                confirmingRemoveUserId === member.userId ? (
                  <View style={styles.confirm}>
                    <Text style={styles.confirmText}>
                      {you
                        ? "You'll lose access to this list until someone shares it with you again."
                        : `${displayNameFor(member)} will lose access to this list until someone shares it with them again.`}
                    </Text>
                    <View style={styles.confirmActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        accessibilityState={{ disabled: pending }}
                        disabled={pending}
                        onPress={() => setConfirmingRemoveUserId(null)}
                        style={styles.cancelButton}>
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Confirm remove ${displayNameFor(member)}`}
                        accessibilityState={{ disabled: pending }}
                        disabled={pending}
                        onPress={() => {
                          // Cleared either way, not just on refusal: on success this member's row
                          // is simply gone next render, but the id would otherwise sit in state
                          // and wrongly re-open the confirm view if the same account is re-invited
                          // later and lands back on the same userId.
                          void run(() => removeMember(listId, member.userId)).then(() => {
                            setConfirmingRemoveUserId(null);
                          });
                        }}
                        style={styles.dangerButton}>
                        <Text style={styles.dangerButtonText}>
                          {pending ? 'Removing…' : 'Remove'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.controls}>
                    <RolePicker
                      value={member.role}
                      labelFor={(role) => `Set ${displayNameFor(member)} to ${role}`}
                      disabled={locked}
                      onChange={(role) => void run(() => setMemberRole(listId, member.userId, role))}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${displayNameFor(member)}`}
                      accessibilityState={{ disabled: locked }}
                      disabled={locked}
                      onPress={() => setConfirmingRemoveUserId(member.userId)}
                      style={styles.remove}>
                      <Text style={[styles.removeText, locked && styles.mutedText]}>Remove</Text>
                    </Pressable>
                  </View>
                )
              ) : you ? (
                !confirmingLeave ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Leave list"
                    accessibilityState={{ disabled: pending }}
                    disabled={pending}
                    onPress={() => setConfirmingLeave(true)}
                    style={styles.remove}>
                    <Text style={[styles.removeText, pending && styles.mutedText]}>Leave list</Text>
                  </Pressable>
                ) : (
                  <View style={styles.confirm}>
                    <Text style={styles.confirmText}>
                      You'll lose access to this list until someone shares it with you again.
                    </Text>
                    <View style={styles.confirmActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        accessibilityState={{ disabled: pending }}
                        disabled={pending}
                        onPress={() => setConfirmingLeave(false)}
                        style={styles.cancelButton}>
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </Pressable>
                      {/* The label stays fixed while the visible text toggles during the request,
                          same convention as AccountScreen's "Sign out of all devices" confirm. */}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Confirm leave list"
                        accessibilityState={{ disabled: pending }}
                        disabled={pending}
                        onPress={() => {
                          void run(() => leaveList(listId)).then((ok) => {
                            if (!ok) setConfirmingLeave(false);
                          });
                        }}
                        style={styles.dangerButton}>
                        <Text style={styles.dangerButtonText}>
                          {pending ? 'Leaving…' : 'Leave list'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )
              ) : (
                <Text style={styles.role}>{member.role}</Text>
              )}
            </View>
          );
        })
      )}

      {manageable && soleOwner ? <Text style={styles.hint}>{LAST_OWNER}</Text> : null}

      {manageable ? (
        <>
          <Text style={styles.heading}>Invite someone</Text>
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
          {/* Re-sharing someone who is already a member is an upsert in `share_list`, so this form
              doubles as a promote and there is nothing extra to build for it. */}
          <View style={styles.invite}>
            <RolePicker
              value={inviteRole}
              labelFor={(role) => `Share as ${role}`}
              disabled={pending}
              onChange={setInviteRole}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share"
              accessibilityState={{ disabled: !canInvite }}
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
              style={[styles.button, !canInvite && styles.buttonDisabled]}>
              <Text style={styles.buttonText}>Share</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text style={styles.hint}>Only an owner can change who has access.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  member: {
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  email: {
    fontSize: 16,
    color: colors.text,
  },
  role: {
    fontSize: 14,
    color: colors.textMuted,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  remove: {
    paddingVertical: spacing.xs,
  },
  removeText: {
    fontSize: 15,
    color: colors.error,
  },
  mutedText: {
    color: colors.textMuted,
  },
  hint: {
    fontSize: 15,
    color: colors.textMuted,
  },
  confirm: {
    gap: spacing.sm,
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
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: 14,
    color: colors.text,
  },
  dangerButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.error,
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onAccent,
  },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  button: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.accentDisabled,
  },
  buttonText: {
    color: colors.onAccent,
    fontSize: 16,
    fontWeight: '600',
  },
});
