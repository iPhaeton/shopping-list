/**
 * The Apple half of `delete-account` and `reset-apple-sign-in`: a client secret, the exchange of an
 * `authorizationCode` for a refresh token, and the revoke of that token, against Apple's REST API.
 *
 * Apple requires an app that offers Sign in with Apple to revoke the user's tokens when the account
 * is deleted. The revoke has a side effect the app copes with in `signInWithApple()`: for a few
 * minutes the device still shows its returning-user sheet, whose token has no email.
 *
 * **Never log** the code, the tokens or the key. The only thing either function logs from Apple is
 * its `error` field (`invalid_grant`, `invalid_client`, …) and the status, which say nothing secret.
 */

/** Not secret: the team the `.p8` belongs to, and the App ID the codes are bound to. */
const TEAM_ID = 'YZ75T58P4Z';
const BUNDLE_ID = 'com.shoppingloop.app';

const APPLE = 'https://appleid.apple.com';
const TIMEOUT_MS = 10_000;

/**
 * Every answer either function gives besides its success, with the sentence the app shows.
 *
 * The statuses are 4xx on purpose: the app's `resultFor` reads a 4xx as `permanent` and shows the
 * message verbatim, while a 5xx reads as `retryable` and shows the offline sentence instead. That is
 * why an unreachable Apple is 424, not 502.
 */
const FAILURES = {
  invalid_request: { status: 400, message: "Apple's sign-in code is missing. Try again." },
  apple_not_linked: { status: 400, message: "This account doesn't sign in with Apple." },
  apple_code_rejected: { status: 400, message: "Apple didn't confirm it's you. Try again." },
  apple_account_mismatch: {
    status: 403,
    message: "That Apple ID isn't the one this account signs in with.",
  },
  apple_unavailable: { status: 424, message: "Apple couldn't be reached. Try again in a minute." },
  // A server without the key: the operator's mistake, not the user's, so it is no 4xx.
  apple_not_configured: { status: 500, message: "Sign in with Apple isn't set up on the server." },
} as const;

export type FailureCode = keyof typeof FAILURES;

/** Apple said no, or could not be asked: the code names which, and `fail` turns it into a response. */
export class AppleFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

export function fail(code: FailureCode): Response {
  const { status, message } = FAILURES[code];
  return Response.json({ code, message }, { status });
}

/** The body both functions take, `{ "authorizationCode": string }`; null when it is not that. */
export async function readCode(request: Request): Promise<string | null> {
  try {
    const { authorizationCode } = await request.json();
    return typeof authorizationCode === 'string' && authorizationCode !== '' ? authorizationCode : null;
  } catch {
    return null;
  }
}

/**
 * Trades the code Apple's sheet just issued for a refresh token. The code lives five minutes and
 * works once. `sub` is the Apple ID the code belongs to: the `id_token` came straight from Apple over
 * TLS, in answer to a request this server signed, so its payload is read without verifying it.
 */
export async function exchangeCode(code: string): Promise<{ sub: string; refreshToken: string }> {
  const response = await post('/auth/token', {
    grant_type: 'authorization_code',
    code,
  });
  const { refresh_token: refreshToken, id_token: idToken } = await response.json();
  const sub = typeof idToken === 'string' ? payloadOf(idToken)?.sub : undefined;
  if (typeof refreshToken !== 'string' || typeof sub !== 'string') {
    console.error('apple /auth/token: 200 without a refresh_token or an id_token sub');
    throw new AppleFailure('apple_unavailable');
  }
  return { sub, refreshToken };
}

/**
 * After this, Settings no longer lists the app. Apple's sheet asks for consent again only once the
 * device has caught up: on an iPhone 13, 10 s after was too soon and 3½ minutes was enough.
 */
export async function revoke(refreshToken: string): Promise<void> {
  await post('/auth/revoke', { token: refreshToken, token_type_hint: 'refresh_token' });
}

/**
 * Apple refusing (a 4xx: a used or expired code, a bad secret) is `apple_code_rejected`, since
 * another tap opens a fresh sheet with a fresh code. No answer, or a 5xx, is `apple_unavailable`.
 */
async function post(path: string, fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams({
    client_id: BUNDLE_ID,
    client_secret: await clientSecret(),
    ...fields,
  });

  let response: Response;
  try {
    response = await fetch(`${APPLE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`apple ${path}: no answer (${(error as Error).name})`);
    throw new AppleFailure('apple_unavailable');
  }
  if (response.ok) return response;

  const { error } = await response.json().catch(() => ({ error: undefined }));
  console.error(`apple ${path}: ${response.status} ${error ?? '(no error field)'}`);
  throw new AppleFailure(response.status >= 500 ? 'apple_unavailable' : 'apple_code_rejected');
}

/**
 * An ES256 JWT signed with the `.p8`, minted for each request and never stored. Apple accepts one
 * for up to six months; five minutes is plenty for a single call.
 */
async function clientSecret(): Promise<string> {
  const keyId = Deno.env.get('APPLE_SIGN_IN_KEY_ID');
  const privateKey = Deno.env.get('APPLE_SIGN_IN_PRIVATE_KEY');
  if (!keyId || !privateKey) {
    console.error('APPLE_SIGN_IN_KEY_ID or APPLE_SIGN_IN_PRIVATE_KEY is not set');
    throw new AppleFailure('apple_not_configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const signingInput = [
    { alg: 'ES256', kid: keyId },
    { iss: TEAM_ID, iat: now, exp: now + 300, aud: APPLE, sub: BUNDLE_ID },
  ]
    .map((part) => base64Url(new TextEncoder().encode(JSON.stringify(part))))
    .join('.');

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8(privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  // WebCrypto's ECDSA signature is already r‖s, the form JWS wants; no DER to unwrap.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

/**
 * The `.p8` as `.env` holds it: the file's text, or that text in base64 on one line, which survives
 * any env loader. A `\n` written out literally is taken as a line break too.
 */
function pkcs8(value: string): ArrayBuffer {
  const pem = value.includes('-----BEGIN') ? value : atob(value.trim());
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n|\s/g, '');
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0)).buffer;
}

function payloadOf(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
