import { fetchProfile, setName } from './profileApi';
import { supabase } from './supabase';

/** `src/lib/supabase.ts` is mocked at the module boundary, the same seam `listsApi.test.ts` and
 * `membersApi.test.ts` mock — `fetchProfile` is a plain read (needs the builder stub) and `setName`
 * is an RPC (needs the rpc stub), so this file needs both. */
jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

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

  it('flags a refusal for a revoked session the same way a write is', async () => {
    respondToRpcWith({
      data: null,
      error: { message: 'this device has been signed out', code: '42501' },
      status: 403,
    });

    expect(await setName('Alice')).toMatchObject({ sessionRevoked: true });
  });
});
