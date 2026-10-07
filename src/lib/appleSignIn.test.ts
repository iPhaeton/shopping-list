import { createHash } from 'node:crypto';

import { AppleAuthenticationScope, formatFullName, signInAsync } from 'expo-apple-authentication';

import { reauthorizeWithApple, signInWithApple } from './appleSignIn';
import { supabase } from './supabase';

/**
 * Both seams below the module under test are mocked, as in `googleSignIn.test.ts`: the native module
 * (so no Apple sheet ever opens under jest) and `./supabase`. `expo-crypto` is not: `jest.setup.ts`
 * backs it with Node's, so the nonce pair asserted here is the real hash of the real value.
 */
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: jest.fn(),
  formatFullName: jest.fn(),
}));
jest.mock('./supabase', () => ({
  supabase: {
    auth: { signInWithIdToken: jest.fn(), updateUser: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

const appleSignIn = jest.mocked(signInAsync);
const format = jest.mocked(formatFullName);
const signInWithIdToken = jest.mocked(supabase.auth.signInWithIdToken);
const updateUser = jest.mocked(supabase.auth.updateUser);
const invoke = jest.mocked(supabase.functions.invoke);

/** What Apple returns on a later authorization: a token, and no name. */
function credential(overrides: object = {}) {
  return {
    user: '001234.abcd',
    identityToken: 'a-real-token',
    authorizationCode: 'a-code',
    email: null,
    fullName: null,
    realUserStatus: 1,
    state: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  appleSignIn.mockResolvedValue(credential());
  signInWithIdToken.mockResolvedValue({ error: null } as never);
  updateUser.mockResolvedValue({ error: null } as never);
  invoke.mockResolvedValue({ data: '', error: null } as never);
});

it('exchanges the identity token for a Supabase session, Apple holding the hash of the raw nonce', async () => {
  const result = await signInWithApple();

  const sentToSupabase = signInWithIdToken.mock.calls[0][0] as { nonce: string };
  const sentToApple = appleSignIn.mock.calls[0][0] as { nonce: string };
  expect(signInWithIdToken).toHaveBeenCalledWith({
    provider: 'apple',
    token: 'a-real-token',
    nonce: expect.any(String),
  });
  expect(sentToApple.nonce).toBe(createHash('sha256').update(sentToSupabase.nonce).digest('hex'));
  expect(sentToApple.nonce).not.toBe(sentToSupabase.nonce);
  expect(result).toEqual({ error: null });
});

it('asks Apple for the full name and the email', async () => {
  await signInWithApple();

  expect(appleSignIn).toHaveBeenCalledWith(
    expect.objectContaining({
      requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
    })
  );
});

it('treats a cancelled sheet as no failure, and calls Supabase for nothing', async () => {
  appleSignIn.mockRejectedValue(Object.assign(new Error('The user canceled'), { code: 'ERR_REQUEST_CANCELED' }));

  const result = await signInWithApple();

  expect(signInWithIdToken).not.toHaveBeenCalled();
  expect(result).toEqual({ error: null });
});

it('surfaces any other failure of the sheet', async () => {
  appleSignIn.mockRejectedValue(Object.assign(new Error('The authorization attempt failed'), { code: 'ERR_REQUEST_FAILED' }));

  const result = await signInWithApple();

  expect(signInWithIdToken).not.toHaveBeenCalled();
  expect(result).toEqual({ error: 'The authorization attempt failed' });
});

it('surfaces a missing identity token instead of calling Supabase with nothing', async () => {
  appleSignIn.mockResolvedValue(credential({ identityToken: null }));

  const result = await signInWithApple();

  expect(signInWithIdToken).not.toHaveBeenCalled();
  expect(result).toEqual({ error: 'Sign-in did not return an identity token' });
});

it('surfaces the message Supabase rejects the token with', async () => {
  signInWithIdToken.mockResolvedValue({ error: { message: 'Nonces mismatch' } } as never);

  const result = await signInWithApple();

  expect(updateUser).not.toHaveBeenCalled();
  expect(result).toEqual({ error: 'Nonces mismatch' });
});

it('saves the name Apple sent, as the suggestion the name gate prefills from', async () => {
  const fullName = { givenName: 'Maya', familyName: 'Lindqvist' };
  appleSignIn.mockResolvedValue(credential({ fullName }));
  format.mockReturnValue(' Maya Lindqvist ');

  await signInWithApple();

  expect(format).toHaveBeenCalledWith(fullName);
  expect(updateUser).toHaveBeenCalledWith({ data: { full_name: 'Maya Lindqvist' } });
});

it('saves no name when Apple sent none, as on every authorization after the first', async () => {
  await signInWithApple();

  expect(updateUser).not.toHaveBeenCalled();
});

it('saves no name when Apple sent only empty parts', async () => {
  appleSignIn.mockResolvedValue(credential({ fullName: { givenName: null, familyName: null } }));
  format.mockReturnValue('');

  await signInWithApple();

  expect(updateUser).not.toHaveBeenCalled();
});

it('still succeeds when saving the name fails', async () => {
  appleSignIn.mockResolvedValue(credential({ fullName: { givenName: 'Maya' } }));
  format.mockReturnValue('Maya');
  updateUser.mockResolvedValue({ error: { message: 'offline' } } as never);

  const result = await signInWithApple();

  expect(result).toEqual({ error: null });
});

describe('reauthorizeWithApple', () => {
  it("returns the code from Apple's sheet, asking for no scopes and calling Supabase for nothing", async () => {
    expect(await reauthorizeWithApple()).toEqual({ code: 'a-code' });
    expect(appleSignIn).toHaveBeenCalledWith({ requestedScopes: [] });
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it('reports a cancelled sheet as a cancel, not a failure', async () => {
    appleSignIn.mockRejectedValue(Object.assign(new Error('The user canceled'), { code: 'ERR_REQUEST_CANCELED' }));

    expect(await reauthorizeWithApple()).toEqual({ cancelled: true });
  });

  it('surfaces any other failure of the sheet', async () => {
    appleSignIn.mockRejectedValue(Object.assign(new Error('The authorization attempt failed'), { code: 'ERR_REQUEST_FAILED' }));

    expect(await reauthorizeWithApple()).toEqual({ error: 'The authorization attempt failed' });
  });

  it('surfaces a missing code', async () => {
    appleSignIn.mockResolvedValue(credential({ authorizationCode: null }));

    expect(await reauthorizeWithApple()).toEqual({ error: 'Apple did not return an authorization code' });
  });
});

/**
 * For a few minutes after a revoke, the device still shows its returning-user sheet, and that token
 * has no email, which GoTrue's user insert cannot take: 500, every time until the device catches up.
 */
describe('the sign-in a revoke leaves behind', () => {
  const RESET_STARTED = 'Sign in with Apple needs a few minutes to reset. Try again in 5 minutes.';
  const RESET_FAILED = "Apple sign-in couldn't finish. Try again in a minute.";

  /** A real three-segment token. `~~~>>>???` puts `-` and `_` into the base64url payload. */
  function jwt(claims: object) {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload = { iss: 'https://appleid.apple.com', sub: '001234.abcd', note: '~~~>>>???' };
    return `${part({ alg: 'RS256', kid: 'apple' })}.${part({ ...payload, ...claims })}.c2lnbmF0dXJl`;
  }
  const RETURNING_TOKEN = jwt({});
  const CONSENT_TOKEN = jwt({ email: 'k2x9dqvmp7@privaterelay.appleid.com' });

  const DATABASE_ERROR = { message: 'Database error saving new user', status: 500 };

  beforeEach(() => {
    appleSignIn.mockResolvedValue(
      credential({ identityToken: RETURNING_TOKEN, authorizationCode: 'sheet-code' })
    );
    signInWithIdToken.mockResolvedValue({ error: DATABASE_ERROR } as never);
  });

  it("revokes with the sheet's code and asks the user to wait, opening no second sheet", async () => {
    expect(await signInWithApple()).toEqual({ error: RESET_STARTED });
    expect(invoke.mock.calls).toEqual([
      ['reset-apple-sign-in', { body: { authorizationCode: 'sheet-code' } }],
    ]);
    expect(appleSignIn).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('says it could not finish when the reset fails', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error('Edge Function returned a non-2xx status code'),
    } as never);

    expect(await signInWithApple()).toEqual({ error: RESET_FAILED });
  });

  it('says it could not finish when Apple sent no code to reset with', async () => {
    appleSignIn.mockResolvedValue(credential({ identityToken: RETURNING_TOKEN, authorizationCode: null }));

    expect(await signInWithApple()).toEqual({ error: RESET_FAILED });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('resets nothing when the failed token carries an email, and shows the failure', async () => {
    appleSignIn.mockResolvedValue(credential({ identityToken: CONSENT_TOKEN }));

    expect(await signInWithApple()).toEqual({ error: 'Database error saving new user' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', { message: 'Failed to fetch', status: 0 }],
    ['a refusal', { message: 'Nonces mismatch', status: 400 }],
  ])('resets nothing on %s, and shows its message', async (_, error) => {
    signInWithIdToken.mockResolvedValue({ error } as never);

    expect(await signInWithApple()).toEqual({ error: error.message });
    expect(invoke).not.toHaveBeenCalled();
  });
});
