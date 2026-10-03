import { isDefaultSort, type ItemSort, type ListSort } from '../state/arrange';
import type { CompletionStatus } from '../state/useCompletion';
import { grouped } from './limits';

/**
 * What the Lists screen and List detail say about a search or a sort — the copy signed off in task
 * 24 step 1, asserted verbatim by the screen suites. Numbers go through `grouped`, never
 * `Intl.NumberFormat`.
 */

type Rows = 'lists' | 'items';

/**
 * The line under the search slot while the stream is being completed, or could not be: how much of
 * it the results cover. `Searching` with a query, `Sorting` with none — a non-default sort alone
 * needs the whole stream too. `held` is the live rows the screen holds. Lists name their `total`
 * (`listCounts.total`, approximate) only when it exceeds `held`.
 */
export function coverageLine({
  rows,
  status,
  searching,
  held,
  total,
}: {
  rows: Rows;
  status: CompletionStatus;
  searching: boolean;
  held: number;
  total?: number;
}): string {
  const [now, past] = searching ? ['Searching', 'Searched'] : ['Sorting', 'Sorted'];
  const n = grouped(held);
  const ofTotal = total !== undefined && total > held ? `${n} of ${grouped(total)} ${rows}` : null;

  switch (status) {
    case 'running':
      return `${now} ${ofTotal ?? `${n} loaded ${rows}`} · loading the rest…`;
    case 'failed':
      return `${past} ${ofTotal ?? `the ${n} loaded ${rows}`}. The rest need a connection.`;
    case 'capped':
      return `${past} the first ${n} ${rows}.`;
  }
}

/**
 * The empty results' title. Never "No matches" over partial data: while the stream is incomplete
 * it says how much was searched, and the coverage line above says the rest.
 */
export function noMatchesTitle({
  query,
  rows,
  partial,
  held,
}: {
  query: string;
  rows: Rows;
  partial: boolean;
  held: number;
}): string {
  return partial ? `No matches in the ${grouped(held)} loaded ${rows}` : `No matches for "${query.trim()}"`;
}

export const NO_MATCHES_HINT = 'Check the spelling, or try fewer letters.';

/**
 * The magnifier's `accessibilityValue` in create mode, where neither the field nor the sort buttons
 * show: the query, then the active sort in priority order — `Searching mi, to do first, then A to
 * Z, oldest first`. `undefined` with nothing to say, which is also when the dot is off.
 */
export function searchSummary(query: string, sort: ListSort | ItemSort): string | undefined {
  const parts: string[] = [];
  const trimmed = query.trim();
  if (trimmed) parts.push(`Searching ${trimmed}`);

  if (!isDefaultSort(sort)) {
    const keys: string[] = [];
    if ('todo' in sort && sort.todo !== null) keys.push(sort.todo === 'first' ? 'to do first' : 'to do last');
    if (sort.az !== null) keys.push(sort.az === 'asc' ? 'A to Z' : 'Z to A');
    if (keys.length > 0) parts.push(keys.join(', then '));
    parts.push(sort.date === 'asc' ? 'oldest first' : 'newest first');
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
}
