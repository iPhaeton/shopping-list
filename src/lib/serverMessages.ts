import { plural, t } from '@lingui/core/macro';

import { LIMIT_CODES, MAX_ITEMS, MAX_LISTS, MAX_OWNED_LISTS } from './limits';

/**
 * What the server wrote when it refused something, as every passthrough has it: a Postgres error
 * from PostgREST (`code` is the SQLSTATE), an auth-js `AuthError` (`code` is GoTrue's), or an Edge
 * Function's `{ code, message }` body. Structural, so this module imports nothing from supabase-js.
 */
export type ServerFailure = { message: string; code?: string | null };

/**
 * The exact message `session_still_valid()` raises (`20260920000000_session_revocation.sql`), and the
 * one the Edge Functions answer a revoked session with. `resultFor` compares the **raw** text with it,
 * before anything is translated: translated, it would never match.
 */
export const SESSION_REVOKED_MESSAGE = 'this device has been signed out';

/**
 * Raised, but never shown, so not in the catalog: SQLSTATE, then text, then why. The drift test
 * (`serverMessages.test.ts`) needs every pair the migrations raise either here or mapped below.
 */
export const NOT_DISPLAYED: Record<string, Record<string, string>> = {
  '42501': {
    [SESSION_REVOKED_MESSAGE]:
      'Sends this device to Sign in: `resultFor` reads it raw as `sessionRevoked`, and every caller redirects.',
  },
};

/**
 * Every GoTrue error the sign-in screen can meet, as provoked on the local stack (GoTrue v2.196.0,
 * 2026-10-13) — the code and text auth-js hands back. `recognise` maps each of these; the drift test
 * checks that its English is this text exactly.
 *
 * GoTrue's per-IP request limit (`over_request_rate_limit`) and its hourly email limit could not be
 * provoked there: the local stack sets no rate-limit header and allows 360,000 emails an hour. Both
 * show as they arrive until someone records them.
 */
export const AUTH_SAMPLES: readonly ServerFailure[] = [
  // A wrong code, a code with a letter in it, and a right code past `otp_expiry` alike.
  { code: 'otp_expired', message: 'Token has expired or is invalid' },
  // An address with no `@`, nothing before it or after it, a space, or two `@`s. `a@b` passes.
  { code: 'validation_failed', message: 'Unable to validate email address: invalid format' },
  // A second code asked for within `max_frequency` of the first: 1 s locally, so 0 seconds are left.
  { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 0 seconds.' },
];

/**
 * The catalog's text for a server message this app recognises, in the active language — or `null`.
 *
 * - **The database** by SQLSTATE plus exact text. Its codes are shared — every permission refusal is
 *   `42501` — so the text is what says which refusal it was. No migration attaches anything more
 *   stable; the drift test reads the migrations instead, so a reworded `raise` fails the suite rather
 *   than quietly falling back to English.
 * - **An Edge Function** by its `code` alone: each code has one message, written in this repo.
 * - **GoTrue** by its `code`, and by the text's shape where the text carries a value — a number of
 *   seconds, which becomes a plural — or where one code covers unrelated texts.
 *
 * A number in a message is never read back out of the database's text: the limits come from
 * `limits.ts`, so the English output is the raw text exactly, `1,000` included.
 */
export function recognise({ message, code }: ServerFailure): string | null {
  if (!code) return null;
  return fromDatabase(code, message) ?? fromEdgeFunction(code) ?? fromAuth(code, message);
}

/** `recognise`, or the text as it arrived (D11): something this app does not know stays English. */
export function serverMessage(failure: ServerFailure): string {
  return recognise(failure) ?? failure.message;
}

/**
 * The database's own words, which reach the screen as written: lowercase, no full stop. Their
 * English stays that (D5); a translator writes a sentence. Keyed by SQLSTATE, then the exact text.
 */
const DATABASE: Record<string, Record<string, () => string>> = {
  '22023': {
    'please enter a name': () =>
      t({
        comment:
          "A refusal from the server when a name is saved empty, under the name field on Set name and Account. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'please enter a name',
      }),
    'please enter at least 3 characters': () => {
      // `set_name`'s minimum (`20260923000000_set_name_min_length.sql`); the screens check it too.
      const characters = 3;
      return t({
        comment:
          "A refusal from the server when a name is too short, under the name field on Set name and Account (# is the minimum, 3). The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: plural(characters, { other: 'please enter at least # characters' }),
      });
    },
    'that name is taken': () =>
      t({
        comment:
          "A refusal from the server when another account already uses this name, under the name field on Set name and Account. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'that name is taken',
      }),
    'they already have this list': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen: the person being invited is already a member of the list. \"they\" is one person whose gender is unknown: avoid gendered forms. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'they already have this list',
      }),
    'they have already been invited': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen: the person being invited already has an open invitation to the list. \"they\" is one person whose gender is unknown: avoid gendered forms. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'they have already been invited',
      }),
    'you already have this list': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen: the person tried to invite themselves. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'you already have this list',
      }),
  },
  '23514': {
    'a list must keep at least one owner': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen: removing or demoting this owner would leave the list with none. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'a list must keep at least one owner',
      }),
  },
  '42501': {
    'not allowed to add to this list': () =>
      t({
        comment:
          "A refusal from the server: the person may not add items to this list any more. Rarely shown; the app usually says this in its own words. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'not allowed to add to this list',
      }),
    'not allowed to change this item': () =>
      t({
        comment:
          "A refusal from the server: the person may not change this item any more. Rarely shown; the app usually says this in its own words. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'not allowed to change this item',
      }),
    'only an owner can change roles on this list': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen, when someone who is no longer an owner changes a member's role. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'only an owner can change roles on this list',
      }),
    'only an owner can delete or restore this list': () =>
      t({
        comment:
          "A refusal from the server: only an owner may put the list in the bin or take it out. Rarely shown; the app usually says this in its own words. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'only an owner can delete or restore this list',
      }),
    'only an owner can invite people to this list': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen, when someone who is no longer an owner invites a person. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'only an owner can invite people to this list',
      }),
    'only an owner can remove members from this list': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen, when someone who is no longer an owner removes a member. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'only an owner can remove members from this list',
      }),
    'only an owner can rename this list': () =>
      t({
        comment:
          "A refusal from the server: only an owner may rename the list. Rarely shown; the app usually says this in its own words. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'only an owner can rename this list',
      }),
  },
  // The limits, in the third person: on Sharing they are about the member an owner is promoting.
  // `humanize()` and `acceptInvitation` say them to the person holding the phone instead.
  [LIMIT_CODES.ownedLists]: {
    'they already own 100 lists': () => {
      const max = MAX_OWNED_LISTS;
      return t({
        comment:
          "A refusal from the server on the Sharing screen: the member being made an owner already owns the most lists allowed (# is that limit, 100). \"they\" is one person whose gender is unknown: avoid gendered forms. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: plural(max, { other: 'they already own # lists' }),
      });
    },
  },
  [LIMIT_CODES.lists]: {
    'they are already on 1,000 lists': () => {
      const max = MAX_LISTS;
      return t({
        comment:
          "A refusal from the server on the Sharing screen: the person is already a member of the most lists allowed (# is that limit, 1,000). \"they\" is one person whose gender is unknown: avoid gendered forms. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: plural(max, { other: 'they are already on # lists' }),
      });
    },
  },
  [LIMIT_CODES.items]: {
    'this list already has 1,000 items': () => {
      const max = MAX_ITEMS;
      return t({
        comment:
          "A refusal from the server: the list holds the most items allowed (# is that limit, 1,000). Rarely shown; the app usually says this in its own words. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: plural(max, { other: 'this list already has # items' }),
      });
    },
  },
  P0002: {
    'that account no longer exists': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen: the person being invited deleted their account meanwhile. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'that account no longer exists',
      }),
    'that person is not a member of this list': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen: the member whose role was changed, or who was removed, has already left. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'that person is not a member of this list',
      }),
    'this invitation is no longer open': () =>
      t({
        comment:
          "A refusal from the server on the Notifications or Sharing screen: the invitation was already answered or withdrawn. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'this invitation is no longer open',
      }),
    'this invitation is no longer valid': () =>
      t({
        comment:
          "A refusal from the server on the Notifications screen: the person who sent the invitation is no longer an owner of the list. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'this invitation is no longer valid',
      }),
    'this list has been deleted': () =>
      t({
        comment:
          "A refusal from the server on the Notifications screen: the list in the invitation was put in the bin. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'this list has been deleted',
      }),
    'this list is in the bin': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen: nobody can be invited to a list in the bin. \"the bin\" is where deleted lists wait 30 days. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'this list is in the bin',
      }),
    'you are not a member of this list': () =>
      t({
        comment:
          "A refusal from the server on the Sharing screen, when leaving a list the person was already removed from. The English is the database's own words, lowercase with no full stop: write a natural sentence, capitalised and punctuated as your language's UI would be.",
        message: 'you are not a member of this list',
      }),
  },
};

/** For the drift test: every database pair this module translates. */
export const DATABASE_MESSAGES: readonly ServerFailure[] = Object.entries(DATABASE).flatMap(
  ([code, texts]) => Object.keys(texts).map((message) => ({ code, message }))
);

function fromDatabase(code: string, message: string): string | null {
  const texts = own(DATABASE, code);
  const text = texts && own(texts, message);
  return text ? text() : null;
}

/**
 * The Edge Functions' answers, by code: `FAILURES` in `supabase/functions/_shared/apple.ts`, and
 * `unauthorized` in `_shared/supabase.ts`. Their English is those files' messages exactly. A revoked
 * session's `42501` there is the database's words, and `NOT_DISPLAYED`'s.
 */
const EDGE_FUNCTIONS: Record<string, () => string> = {
  invalid_request: () =>
    t({
      comment: 'An error from the server while finishing Apple sign-in: the code Apple gave the app did not arrive.',
      message: "Apple's sign-in code is missing. Try again.",
    }),
  apple_not_linked: () =>
    t({
      comment: 'An error from the server, on Account when deleting an account that does not sign in with Apple.',
      message: "This account doesn't sign in with Apple.",
    }),
  apple_code_rejected: () =>
    t({
      comment: 'An error from the server: Apple refused to confirm the person signing in.',
      message: "Apple didn't confirm it's you. Try again.",
    }),
  apple_account_mismatch: () =>
    t({
      comment: 'An error from the server: the Apple ID used is not the one linked to this account.',
      message: "That Apple ID isn't the one this account signs in with.",
    }),
  apple_unavailable: () =>
    t({
      comment: 'An error from the server, on Account when deleting an account: Apple could not be reached.',
      message: "Apple couldn't be reached. Try again in a minute.",
    }),
  apple_not_configured: () =>
    t({
      comment:
        '"Sign in with Apple" is Apple\'s feature: use the name Apple uses in this language. An error from the server: it is missing its Apple settings.',
      message: "Sign in with Apple isn't set up on the server.",
    }),
  unauthorized: () =>
    t({
      comment: 'Shown when an action needs an account and the app is signed out.',
      message: 'Not signed in.',
    }),
};

/** For the drift test: every Edge Function code this module translates. */
export const EDGE_FUNCTION_CODES: readonly string[] = Object.keys(EDGE_FUNCTIONS);

function fromEdgeFunction(code: string): string | null {
  const text = own(EDGE_FUNCTIONS, code);
  return text ? text() : null;
}

/**
 * GoTrue's errors, by `AuthError.code` — every one in `AUTH_SAMPLES`. A code that only ever means one
 * thing is recognised by the code alone, so a GoTrue that rewords it still gets the translation; a
 * code whose text carries a number has it parsed back into a plural; and a code GoTrue uses for
 * unrelated failures (`validation_failed`) also needs the exact text. A text that fits none of these
 * returns `null`, and shows as it arrived.
 */
function fromAuth(code: string, message: string): string | null {
  switch (code) {
    case 'otp_expired':
      return t({
        comment:
          "Under the code field on the sign-in screen: the six-digit code typed was wrong, or too old. The English is the server's own words, with no full stop: write it as your language's UI would.",
        message: 'Token has expired or is invalid',
      });
    case 'over_email_send_rate_limit': {
      // The same code also answers an hourly limit, in words with no number, which stays English.
      const wait = /^For security purposes, you can only request this after (\d+) seconds\.$/.exec(message);
      if (!wait) return null;
      const seconds = Number(wait[1]);
      return t({
        comment:
          'Under the email field on the sign-in screen: a new code was asked for too soon after the last one. # is how many seconds are left, and can be 0.',
        message: plural(seconds, { other: 'For security purposes, you can only request this after # seconds.' }),
      });
    }
    case 'validation_failed':
      return message === 'Unable to validate email address: invalid format'
        ? t({
            comment: 'Under the email field on the sign-in screen: what was typed is not an email address.',
            message: 'Unable to validate email address: invalid format',
          })
        : null;
    default:
      return null;
  }
}

/** A key's own value: a code like `constructor` must not reach `Object.prototype`. */
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
