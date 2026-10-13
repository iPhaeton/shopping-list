import { plural, t } from '@lingui/core/macro';

import type { ListCounts } from '../state/types';

/**
 * The three limits, mirrored from `supabase/migrations/20261001000000_list_limits.sql`, where the
 * database enforces them. Keep the two equal by hand, the way `MAX_ROWS` and `config.toml` are: the
 * database is the authority, and these exist only so the app can warn before the tap and say what a
 * refusal meant.
 *
 * Their own module rather than beside `MAX_ROWS` in `listsApi.ts`: every list suite mocks
 * `listsApi` at the module boundary, so a screen reading a limit from there would read the mock's
 * copy — and a sentence asserted against its own copy proves nothing.
 */
export const MAX_OWNED_LISTS = 100;
export const MAX_LISTS = 1000;
export const MAX_ITEMS = 1000;

/** The SQLSTATE each limit raises — one per limit, so the code alone says which was hit. */
export const LIMIT_CODES = {
  ownedLists: 'LM001',
  lists: 'LM002',
  items: 'LM003',
} as const;

/**
 * What the person holding the phone reads — on the Lists screen before the tap, in the red banner
 * when a queued write is refused, and on Notifications when accepting an invitation would take them
 * past a limit (`acceptInvitation` rephrases the refusal). The database's own words are about
 * somebody else ("they already own 100 lists") and reach only the Sharing screen, when an owner
 * promotes a member who is at a limit — an invitation no longer meets the limits when it is sent,
 * only when it is accepted.
 *
 * Functions rather than constants, so the sentence is in the language active when it is read, not
 * the one active at import. Each is a plural on its limit (D6): English reads the same for every
 * count, so it has only `other`, and `#` is the limit formatted for the language (`1,000` in `en`).
 */
export function ownedListsFull(): string {
  const max = MAX_OWNED_LISTS;
  return t({
    comment: 'Shown when the person owns the most lists allowed (# is that limit, 100).',
    message: plural(max, { other: 'You own # lists. Delete one or hand one over to make room.' }),
  });
}

export function listsFull(): string {
  const max = MAX_LISTS;
  return t({
    comment:
      'Shown when the person is a member of the most lists allowed, their own and shared ones (# is that limit, 1,000).',
    message: plural(max, { other: "You're on # lists. Delete or leave one to make room." }),
  });
}

export function itemsFull(): string {
  const max = MAX_ITEMS;
  return t({
    comment: 'Shown when a list holds the most items allowed (# is that limit, 1,000).',
    message: plural(max, { other: 'This list is full: # items at most.' }),
  });
}

/**
 * The sentence for whichever list limit `counts` has reached, or `null` below both. The total
 * first, because the database checks it first, so the warning and a refusal never disagree.
 */
export function listLimitSentence(counts: ListCounts): string | null {
  if (counts.total >= MAX_LISTS) return listsFull();
  if (counts.owned >= MAX_OWNED_LISTS) return ownedListsFull();
  return null;
}
