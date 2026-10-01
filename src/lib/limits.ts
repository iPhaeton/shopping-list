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

/** `1000` → `1,000`, without leaning on `Intl` being there in every JS engine the app runs in. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ',');
}

/**
 * What the person holding the phone reads — on the Lists screen before the tap, and in the red
 * banner when a queued write is refused. The database's own words are for the Sharing screen,
 * where they are about somebody else ("they already own 100 lists").
 */
export const OWNED_LISTS_FULL = `You own ${grouped(MAX_OWNED_LISTS)} lists. Delete one or hand one over to make room.`;
export const LISTS_FULL = `You're on ${grouped(MAX_LISTS)} lists. Delete or leave one to make room.`;
export const ITEMS_FULL = `This list is full: ${grouped(MAX_ITEMS)} items at most.`;

/**
 * The sentence for whichever list limit `counts` has reached, or `null` below both. The total
 * first, because the database checks it first, so the warning and a refusal never disagree.
 */
export function listLimitSentence(counts: ListCounts): string | null {
  if (counts.total >= MAX_LISTS) return LISTS_FULL;
  if (counts.owned >= MAX_OWNED_LISTS) return OWNED_LISTS_FULL;
  return null;
}
