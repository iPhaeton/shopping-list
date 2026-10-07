import { deleteAccount, deleteAccountWithApple, fetchProfile, setName } from './profileApi';
import { supabase } from './supabase';

/** `src/lib/supabase.ts` is mocked at the module boundary, the same seam `listsApi.test.ts` and
 * `membersApi.test.ts` mock — `fetchProfile` is a plain read (needs the builder stub), `setName`
 * is an RPC (needs the rpc stub), and `deleteAccountWithApple` invokes an Edge Function. */
jest.mock('./supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));

type Response = { data: unknown; error: { message: string; code?: string } | null; status?: number };
type Call = [method: string, args: unknown[]];

function respondWith(response: Response) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: Response) => unknown) => Promise.resolve(response).then(resolve),
  };
  for (const method of ['select', 'eq', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  const from = jest.fn((table: string) => {
    calls.push(['from', [table]]);
    return builder;
  });
  jest.mocked(supabase.from).mockImplementation(from as unknown as typeof supabase.from);
  return { calls };
}

function respondToRpcWith(response: Response) {
  const rpc = jest.fn().mockResolvedValue(response);
  jest.mocked(supabase.rpc).mockImplementation(rpc as unknown as typeof supabase.rpc);
  return rpc;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchProfile', () => {
  it("reads the caller's own name by id", async () => {
    const { calls } = respondWith({ data: { name: 'Alice' }, error: null });

    expect(await fetchProfile('u1')).toEqual({ name: 'Alice', error: null });
    expect(calls).toContainEqual(['from', ['users']]);
    expect(calls).toContainEqual(['eq', ['id', 'u1']]);
  });

  it('reports no name yet as null, not a failure', async () => {
    respondWith({ data: { name: null }, error: null });

    expect(await fetchProfile('u1')).toEqual({ name: null, error: null });
  });

  it('reports a missing row as null rather than throwing', async () => {
    respondWith({ data: null, error: null });

    expect(await fetchProfile('u1')).toEqual({ name: null, error: null });
  });

  it('returns a failed read rather than throwing it', async () => {
    respondWith({ data: null, error: { message: 'JWT expired' } });

    expect(await fetchProfile('u1')).toEqual({ name: null, error: 'JWT expired' });
  });
});

describe('setName', () => {
  it('sends the trimmed name', async () => {
    const rpc = respondToRpcWith({ data: null, error: null, status: 204 });

    await setName('  Alice  ');
    expect(rpc).toHaveBeenLastCalledWith('set_name', { p_name: 'Alice' });
  });

  it('keeps the database\'s own refusal text, like the membership RPCs do', async () => {
    respondToRpcWith({ data: null, error: { message: 'that name is taken', code: '22023' }, status: 400 });

    expect(await setName('Alice')).toEqual({
      error: 'that name is taken',
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });

  it("keeps the database's own refusal text for a name that is too short", async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'please enter at least 3 characters', code: '22023' },
      status: 400,
    });

    expect(await setName('Al')).toEqual({
      error: 'please enter at least 3 characters',
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });

  it('flags a refusal for a revoked session the same way a write is', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'this device has been signed out', code: '42501' },
      status: 403,
    });

    expect(await setName('Alice')).toMatchObject({ sessionRevoked: true });
  });
});

describe('deleteAccount', () => {
  it('calls delete_account with no arguments', async () => {
    const rpc = respondToRpcWith({ data: null, error: null, status: 204 });

    expect(await deleteAccount()).toEqual({ error: null, verdict: 'ok' });
    expect(rpc.mock.calls).toEqual([['delete_account']]);
  });

  it('flags a refusal for a revoked session', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'this device has been signed out', code: '42501' },
      status: 403,
    });

    expect(await deleteAccount()).toEqual({
      error: 'this device has been signed out',
      verdict: 'permanent',
      sessionRevoked: true,
    });
  });

  it('reports a failed fetch as retryable, so the screen can say it needs a connection', async () => {
    respondToRpcWith({ data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 });

    expect(await deleteAccount()).toMatchObject({ verdict: 'retryable', sessionRevoked: false });
  });

  it("keeps the database's own words for any other refusal", async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'canceling statement due to statement timeout', code: '57014' },
      status: 500,
    });

    expect(await deleteAccount()).toMatchObject({
      error: 'canceling statement due to statement timeout',
    });
  });
});

describe('deleteAccountWithApple', () => {
  const invoke = jest.mocked(supabase.functions.invoke);

  /** What functions-js 2.112.4 returns for each kind of failure: the class's name, and for an HTTP
   * error the `Response` as `context`. Only `json()` and `status` of it are read. */
  function failedWith(name: string, context?: { status: number; body: unknown }) {
    const error = Object.assign(new Error(`${name} message`), {
      name,
      context: context && { status: context.status, json: async () => context.body },
    });
    invoke.mockResolvedValue({ data: null, error } as never);
  }

  it('calls delete-account with no body, the tokens being on the server already', async () => {
    invoke.mockResolvedValue({ data: '', error: null } as never);

    expect(await deleteAccountWithApple()).toEqual({ error: null, verdict: 'ok' });
    expect(invoke.mock.calls).toEqual([['delete-account']]);
  });

  it("shows the function's own sentence as a permanent failure", async () => {
    failedWith('FunctionsHttpError', {
      status: 424,
      body: { code: 'apple_unavailable', message: "Apple couldn't be reached. Try again in a minute." },
    });

    expect(await deleteAccountWithApple()).toEqual({
      error: "Apple couldn't be reached. Try again in a minute.",
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });

  it("passes the RPC's refusal for a revoked session back as sessionRevoked", async () => {
    failedWith('FunctionsHttpError', {
      status: 403,
      body: { code: '42501', message: 'this device has been signed out' },
    });

    expect(await deleteAccountWithApple()).toMatchObject({ sessionRevoked: true });
  });

  it('reads a 5xx as retryable, like an RPC that failed on the server', async () => {
    failedWith('FunctionsHttpError', { status: 500, body: { code: 'WORKER_ERROR', message: 'x' } });

    expect(await deleteAccountWithApple()).toMatchObject({ verdict: 'retryable' });
  });

  it('keeps the error when the body is not JSON', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context: { status: 400, json: async () => Promise.reject(new SyntaxError('not JSON')) },
    });
    invoke.mockResolvedValue({ data: null, error } as never);

    expect(await deleteAccountWithApple()).toEqual({
      error: 'Edge Function returned a non-2xx status code',
      verdict: 'permanent',
      sessionRevoked: false,
    });
  });

  it.each(['FunctionsFetchError', 'FunctionsRelayError'])(
    'reads a %s as retryable, so the screen says it needs a connection',
    async (name) => {
      failedWith(name);

      expect(await deleteAccountWithApple()).toMatchObject({ verdict: 'retryable' });
    }
  );
});
