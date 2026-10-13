import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';

import { spokenList } from '../i18n/spokenList';
import { isDefaultSort, type ItemSort, type ListSort } from '../state/arrange';
import type { CompletionStatus } from '../state/useCompletion';

/**
 * What the Lists screen and List detail say about a search or a sort — the copy signed off in task
 * 24 step 1, asserted verbatim by the screen suites. Every sentence is a whole message (no fragments
 * glued together, since word order differs by language), and every count is a plural on it.
 */

type Coverage = {
  status: CompletionStatus;
  searching: boolean;
  held: number;
} & ({ rows: 'lists'; total?: number } | { rows: 'items' });

/**
 * The line under the search slot while the stream is being completed, or could not be: how much of
 * it the results cover. `Searching` with a query, `Sorting` with none — a non-default sort alone
 * needs the whole stream too. `held` is the live rows the screen holds. Lists name their `total`
 * (`listCounts.total`, approximate) only when it exceeds `held`; items have no total.
 *
 * Sixteen messages, one per sentence shape, rather than one with nested `select`s: each is a plain
 * plural a translator can read on its own.
 */
export function coverageLine(coverage: Coverage): string {
  const { status, searching, held } = coverage;
  const total = coverage.rows === 'lists' ? coverage.total : undefined;

  if (status !== 'capped' && total !== undefined && total > held) {
    // `loaded` governs no noun, so it is a formatted number, not a plural; `#` is the total.
    const loaded = i18n.number(held);
    if (status === 'running') {
      return searching
        ? t({
            comment:
              'Under the search field while the rest of the lists load in the background. {loaded} is how many are loaded so far; # is the approximate total.',
            message: plural(total, { other: `Searching ${loaded} of # lists · loading the rest…` }),
          })
        : t({
            comment:
              'Under the sort buttons while the rest of the lists load in the background. {loaded} is how many are loaded so far; # is the approximate total.',
            message: plural(total, { other: `Sorting ${loaded} of # lists · loading the rest…` }),
          });
    }
    return searching
      ? t({
          comment:
            'Under the search field when the rest of the lists could not load (offline). {loaded} is how many were searched; # is the approximate total.',
          message: plural(total, { other: `Searched ${loaded} of # lists. The rest need a connection.` }),
        })
      : t({
          comment:
            'Under the sort buttons when the rest of the lists could not load (offline). {loaded} is how many were sorted; # is the approximate total.',
          message: plural(total, { other: `Sorted ${loaded} of # lists. The rest need a connection.` }),
        });
  }

  const count = held;
  switch (status) {
    case 'running':
      if (coverage.rows === 'lists') {
        return searching
          ? t({
              comment: 'Under the search field while the rest of the lists load in the background. # is how many are loaded so far.',
              message: plural(count, { other: 'Searching # loaded lists · loading the rest…' }),
            })
          : t({
              comment: 'Under the sort buttons while the rest of the lists load in the background. # is how many are loaded so far.',
              message: plural(count, { other: 'Sorting # loaded lists · loading the rest…' }),
            });
      }
      return searching
        ? t({
            comment: "Under the search field while the rest of a list's items load in the background. # is how many are loaded so far.",
            message: plural(count, { other: 'Searching # loaded items · loading the rest…' }),
          })
        : t({
            comment: "Under the sort buttons while the rest of a list's items load in the background. # is how many are loaded so far.",
            message: plural(count, { other: 'Sorting # loaded items · loading the rest…' }),
          });

    case 'failed':
      if (coverage.rows === 'lists') {
        return searching
          ? t({
              comment: 'Under the search field when the rest of the lists could not load (offline). # is how many were searched.',
              message: plural(count, { other: 'Searched the # loaded lists. The rest need a connection.' }),
            })
          : t({
              comment: 'Under the sort buttons when the rest of the lists could not load (offline). # is how many were sorted.',
              message: plural(count, { other: 'Sorted the # loaded lists. The rest need a connection.' }),
            });
      }
      return searching
        ? t({
            comment: "Under the search field when the rest of a list's items could not load (offline). # is how many were searched.",
            message: plural(count, { other: 'Searched the # loaded items. The rest need a connection.' }),
          })
        : t({
            comment: "Under the sort buttons when the rest of a list's items could not load (offline). # is how many were sorted.",
            message: plural(count, { other: 'Sorted the # loaded items. The rest need a connection.' }),
          });

    case 'capped':
      if (coverage.rows === 'lists') {
        return searching
          ? t({
              comment: 'Under the search field when only the first lists could be searched: there are too many to load. # is how many.',
              message: plural(count, { other: 'Searched the first # lists.' }),
            })
          : t({
              comment: 'Under the sort buttons when only the first lists could be sorted: there are too many to load. # is how many.',
              message: plural(count, { other: 'Sorted the first # lists.' }),
            });
      }
      return searching
        ? t({
            comment: "Under the search field when only a list's first items could be searched: there are too many to load. # is how many.",
            message: plural(count, { other: 'Searched the first # items.' }),
          })
        : t({
            comment: "Under the sort buttons when only a list's first items could be sorted: there are too many to load. # is how many.",
            message: plural(count, { other: 'Sorted the first # items.' }),
          });
  }
}

/**
 * The empty results' title. Never "No matches" over partial data: while the stream is incomplete
 * it says how much was searched, and the coverage line above says the rest.
 */
export function noMatchesTitle({
  query: typed,
  rows,
  partial,
  held,
}: {
  query: string;
  rows: 'lists' | 'items';
  partial: boolean;
  held: number;
}): string {
  if (!partial) {
    const query = typed.trim();
    return t({
      comment: 'Title when a search finds nothing. {query} is what the person typed, inserted as typed.',
      message: `No matches for "${query}"`,
    });
  }
  const count = held;
  return rows === 'lists'
    ? t({
        comment: 'Title when a search of the lists loaded so far finds nothing; the rest are still to load. # is how many were searched.',
        message: plural(count, { other: 'No matches in the # loaded lists' }),
      })
    : t({
        comment: "Title when a search of a list's items loaded so far finds nothing; the rest are still to load. # is how many were searched.",
        message: plural(count, { other: 'No matches in the # loaded items' }),
      });
}

/** The hint under any no-matches title. */
export function noMatchesHint(): string {
  return t({
    comment: 'Under the title when a search finds nothing.',
    message: 'Check the spelling, or try fewer letters.',
  });
}

/**
 * The magnifier's `accessibilityValue` in create mode, where neither the field nor the sort buttons
 * show: the query, then the active sort in priority order — `Searching mi, to do first, then A to
 * Z, oldest first`. `undefined` with nothing to say, which is also when the dot is off.
 */
export function searchSummary(typed: string, sort: ListSort | ItemSort): string | undefined {
  const parts: string[] = [];
  const query = typed.trim();
  if (query) {
    parts.push(
      t({
        comment: 'VoiceOver only: the search in force. {query} is what the person typed, inserted as typed.',
        message: `Searching ${query}`,
      })
    );
  }

  if (!isDefaultSort(sort)) {
    const keys: string[] = [];
    if ('todo' in sort && sort.todo !== null) {
      keys.push(
        sort.todo === 'first'
          ? t({ comment: 'VoiceOver only: a sort order in force, items still to do before done ones.', message: 'to do first' })
          : t({ comment: 'VoiceOver only: a sort order in force, done items before those still to do.', message: 'to do last' })
      );
    }
    if (sort.az !== null) {
      keys.push(
        sort.az === 'asc'
          ? t({ comment: 'VoiceOver only: a sort order, alphabetical.', message: 'A to Z' })
          : t({ comment: 'VoiceOver only: a sort order, reverse alphabetical.', message: 'Z to A' })
      );
    }
    if (keys.length > 0) {
      let order = keys[0];
      for (const next of keys.slice(1)) {
        order = t({
          comment: 'VoiceOver only: two sort orders in priority order, e.g. "to do first, then A to Z".',
          message: `${order}, then ${next}`,
        });
      }
      parts.push(order);
    }
    parts.push(
      sort.date === 'asc'
        ? t({ comment: 'VoiceOver only: a sort order in force, by date added.', message: 'oldest first' })
        : t({ comment: 'VoiceOver only: a sort order in force, by date added.', message: 'newest first' })
    );
  }

  return parts.length > 0 ? spokenList(parts) : undefined;
}
