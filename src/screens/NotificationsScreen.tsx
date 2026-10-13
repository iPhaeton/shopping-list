import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { Backdrop } from '../components/Backdrop';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { HorizonFooter } from '../components/HorizonFooter';
import { ChevronIcon } from '../components/icons';
import { PillButton } from '../components/PillButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSky } from '../components/Sky';
import { spokenList } from '../i18n/spokenList';
import { ago } from '../lib/ago';
import {
  acceptInvitation,
  blockInviter,
  declineInvitation,
  fetchNotifications,
  markNotificationsRead,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_RELOAD_MAX,
  type Notification,
  type NotificationCursor,
} from '../lib/notificationsApi';
import type { NotificationsScreenProps } from '../navigation/types';
import { useLists } from '../state/ListsContext';
import { useNotifications } from '../state/NotificationsContext';
import { useSession } from '../state/SessionContext';
import { themedStyles, useTheme } from '../state/ThemeContext';
import type { Role } from '../state/types';
import { fonts, radius, spacing } from '../theme';

/** As `NotificationsContext` collapses a burst of nudges: marking n rows read sends n of them. */
const NUDGE_DEBOUNCE_MS = 300;

/** A stable empty array while the first page loads, so the `FlatList`'s `data` never allocates one. */
const NONE: Notification[] = [];

/**
 * A card's sentence: one whole message per kind, so a language orders the two names its own way.
 * A descriptor, so the one message serves twice — rendered with the names in bold, where `name` and
 * `listName` are `<Text>`s that `Trans` slots in as elements (never parsed as text), and as the plain
 * string in the card's `accessibilityValue`.
 */
function sentence(kind: Notification['kind'], name: ReactNode, listName: ReactNode): MessageDescriptor {
  switch (kind) {
    case 'list_invitation':
      return msg({
        comment: "A notification: someone invited this person to a list. {name} is a person's name as they typed it: never inflect it. Their gender is unknown, so avoid a gendered past tense; use a present tense, a passive or a label form. {listName} is the list's name as typed: never inflect it.",
        message: `${name} invited you to ${listName}`,
      });
    case 'invitation_accepted':
      return msg({
        comment: "A notification: someone accepted this person's invitation to a list. {name} is a person's name as they typed it: never inflect it. Their gender is unknown, so avoid a gendered past tense; use a present tense, a passive or a label form. {listName} is the list's name as typed: never inflect it.",
        message: `${name} accepted your invitation to ${listName}`,
      });
    case 'invitation_declined':
      return msg({
        comment: "A notification: someone declined this person's invitation to a list. {name} is a person's name as they typed it: never inflect it. Their gender is unknown, so avoid a gendered past tense; use a present tense, a passive or a label form. {listName} is the list's name as typed: never inflect it.",
        message: `${name} declined your invitation to ${listName}`,
      });
  }
}

/** Block is a decline first (D2), so it answers the invitation as the other two do. */
type Answer = 'accept' | 'decline' | 'block';

/**
 * Invitations to you, and the answers to yours (task 28), newest first, a page of 100 at a time
 * (D8). Online-only, like Sharing: the rows are local `useState`, nothing is cached, and Accept and
 * Decline go straight to the database rather than through the outbox.
 *
 * **Every read replaces from the top.** A reload — on mount, on a `notifications/changed` nudge, and
 * after every answer — re-reads in one call every row shown (at least a page), so a withdrawn
 * invitation disappears and an answered one changes state on every loaded page, not only the first.
 * It asks for one row more than is shown: a full answer is how a page says there is more, so asking
 * for exactly what is shown would bring the cursor back on a screen already at its end, and the
 * next scroll there would read an empty page. Only the latest reload to start may land, and a scroll
 * page lands only if it continues the cursor the screen still holds — a reload that replaced the
 * cursor meanwhile drops it, and the next scroll asks again. `first-fetch-replaces-list-state`
 * records the same rule for the lists.
 *
 * **Block (D5) is a confirm on the card, then a reload.** The database drops every card from that
 * person, so the reload takes them off every loaded page. **A return to this screen reloads too**:
 * from Blocked people, an unblock brings that person's cards back, and only their restored
 * invitations nudge about it.
 * Only a focus after a blur counts — the focus that comes with the push itself finds the mount's
 * read already on its way.
 *
 * **Read marking is per page (D4, D8).** Each landing marks exactly its own rows that were unread
 * and not yet seen this visit, then re-reads the bell's count. Unread rows on pages not scrolled to
 * stay unread, so the bell can stay marked until they are reached. The dots are drawn from what this
 * visit has seen, never from the reloaded `readAt`: the mark's own nudges reload the screen, and the
 * dots must last the visit. A reload that finds nothing new sends no mark, which ends that loop.
 *
 * Laid out on Account's frame: the fixed sky, the drawn header, the cards, and the landscape after
 * the last of them — under the next page's spinner while one is on its way.
 */
export function NotificationsScreen({ navigation }: NotificationsScreenProps) {
  const styles = useStyles();
  const { t, i18n } = useLingui();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { lists, refresh, lastNotificationsNudge } = useLists();
  const { refreshUnread } = useNotifications();
  const { signOut } = useSession();

  const [rows, setRows] = useState<Notification[] | null>(null);
  const [cursor, setCursor] = useState<NotificationCursor | null>(null);
  // A failed first load, cleared by any load that lands; and a refused answer, cleared by the next
  // answer only — the reload after a refusal must not wipe the reason before it is read.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<{ id: string; answer: Answer } | null>(null);
  // The card whose Block confirm is open, by notification id.
  const [confirmingBlockId, setConfirmingBlockId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // The ids that were unread when this visit first loaded them.
  const [dots, setDots] = useState<ReadonlySet<string>>(() => new Set());

  // What the reads check between awaits, set in the same breath as the state they mirror.
  const rowsRef = useRef<Notification[] | null>(null);
  const cursorRef = useRef<NotificationCursor | null>(null);
  const seen = useRef(new Set<string>());
  const reloadSeq = useRef(0);
  const paging = useRef(false);
  const live = useRef(true);
  // A nudge from before this screen opened is old news: the mount read is newer.
  const nudgeAtMount = useRef(lastNotificationsNudge);
  // Whether another screen covered this one since it last had focus.
  const left = useRef(false);

  function show(next: Notification[], nextCursor: NotificationCursor | null) {
    rowsRef.current = next;
    cursorRef.current = nextCursor;
    setRows(next);
    setCursor(nextCursor);
  }

  /** Marks what `landed` brought that was unread and not yet seen — exactly those ids. */
  function markLanded(landed: Notification[]) {
    const fresh = landed.filter((n) => n.readAt === null && !seen.current.has(n.id)).map((n) => n.id);
    if (fresh.length === 0) return;

    for (const id of fresh) seen.current.add(id);
    setDots(new Set(seen.current));

    void (async () => {
      const { sessionRevoked } = await markNotificationsRead(fresh);
      if (sessionRevoked) {
        void signOut('revoked');
        return;
      }
      // Re-read, never set to 0: the answer already counts anything that arrived meanwhile.
      await refreshUnread();
    })();
  }

  async function reload() {
    const mine = ++reloadSeq.current;
    const shown = rowsRef.current?.length ?? 0;
    const limit = Math.min(Math.max(shown + 1, NOTIFICATION_PAGE_SIZE), NOTIFICATION_RELOAD_MAX);
    const { notifications, cursor: next, error, retryable } = await fetchNotifications({ limit });
    if (!live.current || mine !== reloadSeq.current) return;

    if (!notifications) {
      // With rows on screen a failed reload changes nothing: they stay, and the next nudge asks again.
      if (rowsRef.current === null) {
        setLoadError(
          retryable
            ? t({
                comment: 'Shown when the notifications could not load for lack of a connection.',
                message: 'You need a connection to see your notifications.',
              })
            : error
        );
      }
      return;
    }

    setLoadError(null);
    show(notifications, next);
    markLanded(notifications);
  }

  async function loadMore() {
    const asked = cursorRef.current;
    if (paging.current || asked === null) return;

    paging.current = true;
    setLoadingMore(true);
    try {
      const { notifications, cursor: next } = await fetchNotifications({
        before: asked,
        limit: NOTIFICATION_PAGE_SIZE,
      });
      // A failed page shows nothing; the next scroll to the end asks again. A page asked from a
      // cursor that a reload has since replaced continues nothing on screen, so it is dropped.
      if (!live.current || !notifications || cursorRef.current !== asked) return;
      show([...(rowsRef.current ?? []), ...notifications], next);
      markLanded(notifications);
    } finally {
      paging.current = false;
      if (live.current) setLoadingMore(false);
    }
  }

  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
    // Mount only: `reload` reads everything it needs through refs.
  }, []);

  useEffect(() => {
    const offBlur = navigation.addListener('blur', () => {
      left.current = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!left.current) return;
      left.current = false;
      void reload();
    });
    return () => {
      offBlur();
      offFocus();
    };
    // Subscribed once: `reload` reads everything it needs through refs.
  }, [navigation]);

  useEffect(() => {
    if (!lastNotificationsNudge || lastNotificationsNudge === nudgeAtMount.current) return;
    const timer = setTimeout(() => void reload(), NUDGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [lastNotificationsNudge]);

  async function answer(n: Extract<Notification, { kind: 'list_invitation' }>, choice: Answer) {
    setActionError(null);
    setInFlight({ id: n.id, answer: choice });

    const result =
      choice === 'accept'
        ? await acceptInvitation(n.invitationId)
        : choice === 'decline'
          ? await declineInvitation(n.invitationId)
          : await blockInviter(n.invitationId);
    if (!live.current) return;

    // This device's session was revoked elsewhere: hand off to sign-in, as Sharing's `run` does.
    if (result.sessionRevoked) {
      void signOut('revoked');
      return;
    }

    if (result.error && result.verdict === 'retryable') {
      setActionError(
        t({
          comment: 'Shown when answering an invitation failed for lack of a connection.',
          message: 'You need a connection to answer an invitation.',
        })
      );
      setInFlight(null);
      setConfirmingBlockId(null);
      return;
    }

    // A refusal — limits already in the second person — or a success: either way the card's truth is
    // the database's now, so re-read. The pending text holds until it lands, so the old buttons
    // never come back for a moment under a finger.
    if (result.error) setActionError(result.error);
    else if (choice === 'accept') void refresh();
    await reload();
    if (!live.current) return;
    setInFlight(null);
    setConfirmingBlockId(null);
  }

  const now = Date.now();
  const held = (listId: string) => lists.some((list) => list.id === listId);

  /** A pending invitation's role, under its sentence. */
  function roleLead(role: Role): string {
    switch (role) {
      case 'reader':
        return t({ comment: 'Under a pending invitation: the role it offers, can only see the list. Short, small print.', message: 'as a reader' });
      case 'writer':
        return t({ comment: 'Under a pending invitation: the role it offers, can add and change items. Short, small print.', message: 'as a writer' });
      case 'owner':
        return t({ comment: 'Under a pending invitation: the role it offers, can also share, rename and delete the list. Short, small print.', message: 'as an owner' });
    }
  }

  function renderCard(n: Notification) {
    const dotted = dots.has(n.id);
    const invitation = n.kind === 'list_invitation' ? n : null;
    const name = n.actorName;
    const listName = n.listName;
    const joined = invitation !== null && invitation.status === 'accepted';
    const outcome = !invitation
      ? null
      : joined
        ? t({
            comment: 'Under an invitation this person accepted: they are now a member of the list. Short, small print.',
            message: 'You joined',
          })
        : invitation.status === 'declined'
          ? t({ comment: 'Under an invitation this person declined (a state, not a button). Short, small print.', message: 'Declined' })
          : invitation.available
            ? null
            : t({
                comment: 'Under an invitation that can no longer be answered: the list was deleted or the invitation withdrawn. Short, small print.',
                message: 'No longer available',
              });
    const pending = invitation !== null && outcome === null;
    const resolved = invitation !== null && outcome !== null;
    const opens = invitation ? invitation.status === 'accepted' : n.kind === 'invitation_accepted' && held(n.listId);

    const age = ago(n.createdAt, now);
    // The line under the sentence: a pending invitation's role, a resolved one's outcome in its
    // place, an answer's age alone.
    const lead = pending && invitation ? roleLead(invitation.role) : outcome;
    const unread = t({
      comment: 'VoiceOver only: the dot on an avatar that marks a notification not seen before.',
      message: 'Unread',
    });

    const body = (
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Avatar id={n.actorId} name={n.actorName} />
          {dotted ? <View accessible accessibilityLabel={unread} style={styles.dot} /> : null}
        </View>
        <View style={styles.text}>
          <Text style={[styles.sentence, resolved && styles.muted, dotted && styles.strong]}>
            <Trans
              {...sentence(
                n.kind,
                <Text style={styles.strong}>{name}</Text>,
                <Text style={styles.strong}>{listName}</Text>
              )}
            />
          </Text>
          <Text style={styles.meta}>
            {joined ? <Text style={styles.joined}>{lead}</Text> : lead}
            {lead ? ' · ' : ''}
            {age}
          </Text>
        </View>
        {opens ? (
          <View style={styles.chevron}>
            <ChevronIcon color={colors.text} />
          </View>
        ) : null}
      </View>
    );

    if (opens) {
      // The whole card is the button, so its label swallows what is inside: the value carries the
      // sentence and the line under it, and the dot's `Unread` leads.
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t({
            comment: "VoiceOver only: a notification card that opens its list. {listName} is the list's name as typed: never inflect it.",
            message: `Open ${listName}`,
          })}
          accessibilityValue={{
            text: spokenList([
              ...(dotted ? [unread] : []),
              i18n._(sentence(n.kind, name, listName)),
              ...(lead ? [lead] : []),
              age,
            ]),
          }}
          onPress={() => navigation.navigate('ListDetail', { listId: n.listId })}
          style={({ pressed }) => pressed && styles.pressed}>
          <Card style={styles.card}>{body}</Card>
        </Pressable>
      );
    }

    const running = inFlight?.id === n.id ? inFlight.answer : null;
    const busy = inFlight !== null;
    return (
      <Card style={styles.card}>
        {body}
        {pending && invitation && confirmingBlockId === n.id ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>
              {t({
                comment:
                  "The confirm before blocking the person who sent an invitation. {name} is a person's name as they typed it: never inflect it. Their gender is unknown, so avoid a gendered past tense; use a present tense, a passive or a label form. “Blocked people” is the name of that screen: use its translation.",
                message: `${name} will be told you declined, and you won't see invitations from them any more. Unblock them any time under Blocked people.`,
              })}
            </Text>
            <View style={styles.confirmActions}>
              <PillButton
                label={t({ comment: "VoiceOver only: the Cancel button under the block confirm. {name} is a person's name as they typed it: never inflect it. Their gender is unknown, so avoid a gendered past tense; use a present tense, a passive or a label form.", message: `Cancel blocking ${name}` })}
                visibleLabel={t({ comment: 'Button (verb): closes the confirm or editor without doing anything. Fits about 12 characters, half of a row of two buttons.', message: 'Cancel' })}
                size="md"
                disabled={busy}
                onPress={() => setConfirmingBlockId(null)}
                style={styles.half}
              />
              <PillButton
                label={t({ comment: "VoiceOver only: the button that confirms blocking someone. {name} is a person's name as they typed it: never inflect it. Their gender is unknown, so avoid a gendered past tense; use a present tense, a passive or a label form.", message: `Confirm block ${name}` })}
                visibleLabel={
                  running === 'block'
                    ? t({ comment: 'The Block button while the block is being sent. Fits about 12 characters.', message: 'Blocking…' })
                    : t({
                        comment: 'Button (verb) in a confirm: blocks the person who sent the invitation. Fits about 12 characters, half of a row.',
                        message: 'Block',
                      })
                }
                variant="danger"
                size="md"
                disabled={busy}
                onPress={() => void answer(invitation, 'block')}
                style={styles.half}
              />
            </View>
          </View>
        ) : pending && invitation ? (
          <>
            <View style={styles.actions}>
              <PillButton
                label={t({ comment: "VoiceOver only: the Decline button on an invitation. {listName} is the list's name as typed: never inflect it.", message: `Decline invitation to ${listName}` })}
                visibleLabel={
                  running === 'decline'
                    ? t({ comment: 'The Decline button while the answer is being sent. Fits about 12 characters.', message: 'Declining…' })
                    : t({
                        comment: 'Button (verb) on an invitation: says no to it. Fits about 12 characters, half of a row.',
                        message: 'Decline',
                      })
                }
                size="md"
                disabled={busy}
                onPress={() => void answer(invitation, 'decline')}
                style={styles.half}
              />
              <PillButton
                label={t({ comment: "VoiceOver only: the Accept button on an invitation. {listName} is the list's name as typed: never inflect it.", message: `Accept invitation to ${listName}` })}
                visibleLabel={
                  running === 'accept'
                    ? t({ comment: 'The Accept button while the answer is being sent. Fits about 12 characters.', message: 'Accepting…' })
                    : t({
                        comment: 'Button (verb) on an invitation: joins the list. Fits about 12 characters, half of a row.',
                        message: 'Accept',
                      })
                }
                variant="filled"
                size="md"
                disabled={busy}
                onPress={() => void answer(invitation, 'accept')}
                style={styles.half}
              />
            </View>
            {/* A name of any length fits: the pill cuts it with `…`; the label keeps it whole. */}
            <PillButton
              label={t({
                comment: "Button under an invitation: opens the confirm to block its sender. Full width; a long name is cut with …. {name} is a person's name as they typed it: never inflect it. Their gender is unknown, so avoid a gendered past tense; use a present tense, a passive or a label form.",
                message: `Block ${name}`,
              })}
              size="md"
              tone="danger"
              disabled={busy}
              onPress={() => setConfirmingBlockId(n.id)}
              style={styles.block}
            />
          </>
        ) : null}
      </Card>
    );
  }

  const error = actionError ?? loadError;

  return (
    <Backdrop art={<ScreenSky />}>
      {error ? (
        <View style={{ paddingTop: insets.top }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      <FlatList
        data={rows ?? NONE}
        keyExtractor={(n) => n.id}
        renderItem={({ item, index }) => (
          <View style={[styles.item, index === 0 && styles.first]}>{renderCard(item)}</View>
        )}
        extraData={[dots, inFlight, confirmingBlockId, lists]}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.content}
        // The way to Blocked people sits in the header, there on every page and on the empty state:
        // after the last card it would wait on every page loading first.
        ListHeaderComponent={
          <ScreenHeader
            title={t({
              comment: 'The Notifications screen: its title, and the label of the bell button that opens it.',
              message: 'Notifications',
            })}
            onBack={() => navigation.goBack()}
            right={
              <PillButton
                label={t({
                  comment: 'The Blocked people screen: its title, and the buttons that open it from Account and Notifications.',
                  message: 'Blocked people',
                })}
                onPress={() => navigation.navigate('BlockedPeople')}
              />
            }
          />
        }
        ListEmptyComponent={
          rows !== null ? (
            <EmptyState
              title={t({ comment: 'Title of the Notifications screen when there are none.', message: 'No notifications yet' })}
              hint={t({
                comment: 'Under the title when there are no notifications.',
                message: 'Invitations to shared lists show up here.',
              })}
              ink={colors.text}
            />
          ) : loadError ? null : (
            <View style={styles.loading}>
              <ActivityIndicator
                accessibilityLabel={t({ comment: 'VoiceOver only: a spinner while the notifications load.', message: 'Loading notifications' })}
                color={colors.text}
              />
            </View>
          )
        }
        // After the last card: the next page's spinner while one is on its way, then the landscape,
        // pushed to the bottom of a short page and scrolled to on a long one, as on Account.
        ListFooterComponent={
          <View style={styles.footer}>
            {loadingMore ? (
              <ActivityIndicator
                accessibilityLabel={t({
                  comment: 'VoiceOver only: a spinner while the next page of notifications loads.',
                  message: 'Loading more notifications',
                })}
                color={colors.text}
                style={styles.loadingMore}
              />
            ) : null}
            <View style={styles.spacer} />
            <HorizonFooter />
          </View>
        }
        ListFooterComponentStyle={styles.footer}
        onEndReached={cursor !== null && !loadingMore ? () => void loadMore() : undefined}
        onEndReachedThreshold={0.5}
      />
    </Backdrop>
  );
}

function Separator() {
  return <View style={{ height: 10 }} />;
}

// Measured off the Notifications mockups (task 28 step 2): cards at x 20–370, 10pt apart, the first
// 12 under the title, padded 14/13 as Sharing's member cards are; a 36pt avatar, the text 13 after
// it; Decline and Accept half each, 11 apart, 12 under the text, Block full width 10 under them.
// The Block confirm takes all three's place as Sharing's confirm does: the warning 10 under the
// text, its two pills half each, 11 apart, 10 under it.
const useStyles = themedStyles((colors) => ({
  content: {
    flexGrow: 1,
  },
  item: {
    paddingHorizontal: 20,
  },
  first: {
    marginTop: 12,
  },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
  },
  avatar: {
    marginTop: 2,
  },
  // The bell's dot, on the avatar's top right, its ring in `surface` — the card's own base under its
  // `cardFill` — so it reads as cut out of the disc.
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.primary,
  },
  text: {
    flex: 1,
  },
  sentence: {
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  strong: {
    fontFamily: fonts.sansSemiBold,
  },
  muted: {
    color: colors.textSecondary,
  },
  meta: {
    marginTop: 2,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  joined: {
    fontFamily: fonts.sansSemiBold,
    color: colors.text,
  },
  chevron: {
    alignSelf: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 11,
    marginTop: 12,
  },
  half: {
    flex: 1,
  },
  block: {
    marginTop: 10,
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
  pressed: {
    opacity: 0.6,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
  },
  // Lists' `loadingMore`: 12 above and below, centred under the last card.
  loadingMore: {
    paddingVertical: spacing.md,
  },
  footer: {
    flexGrow: 1,
  },
  // As on Account: room enough that the sun does not crowd the last card on a page that fills the
  // screen.
  spacer: {
    flex: 1,
    minHeight: 64,
  },
}));
