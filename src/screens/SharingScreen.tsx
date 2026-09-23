import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { RolePicker } from '../components/RolePicker';
import { UserAutocomplete } from '../components/UserAutocomplete';
import type { Result } from '../lib/listsApi';
import {
  fetchMembers,
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
  const { lists, userId, refresh } = useLists();
  const { signOut } = useSession();
  const list = lists.find((candidate) => candidate.id === listId);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<UserSuggestion | null>(null);
  const [inviteRole, setInviteRole] = useState<Role>('writer');

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

  const manageable = list ? canManageList(list.role) : false;
  const owners = members?.filter((member) => member.role === 'owner') ?? [];
  // Disabling your own demote and remove is a courtesy; the trigger is what actually decides, and
  // two clients can race, so its refusal is still rendered when it comes.
  const soleOwner = owners.length === 1 && owners[0].userId === userId;

  /**
   * Every membership write goes through here: disable the controls, send, then either say what went
   * wrong or re-read both the roster and the lists.
   */
  async function run(call: () => Promise<Result>) {
    setPending(true);
    setError(null);

    const { error: failure, verdict, sessionRevoked } = await call();

    if (failure) {
      // This device's own session was revoked elsewhere — hand off to the sign-in screen rather than
      // showing a refusal the roster will just repeat on the next attempt. Pending is left as-is,
      // matching `SignInScreen.verifyCode`'s pattern for a path that's about to unmount.
      if (sessionRevoked) {
        void signOut('revoked');
        return;
      }

      // `verdict` rather than the status: `P0002` — "that account no longer exists" — arrives as a
      // 500 and is classified by its SQLSTATE, so a vanished target does not read as an outage.
      setError(verdict === 'retryable' ? 'You need a connection to change who has access.' : failure);
      setPending(false);
      return;
    }

    const rows = await load();
    void refresh();
    setPending(false);

    // Removing or demoting yourself is legal for an owner while another owner remains. If your own
    // membership is gone, this list is no longer yours to look at.
    if (rows && !rows.some((member) => member.userId === userId)) navigation.popToTop();
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
                    onPress={() => void run(() => removeMember(listId, member.userId))}
                    style={styles.remove}>
                    <Text style={[styles.removeText, locked && styles.mutedText]}>Remove</Text>
                  </Pressable>
                </View>
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
