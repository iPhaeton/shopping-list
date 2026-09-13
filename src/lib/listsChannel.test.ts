import { subscribeToChanges } from './listsChannel';
import { supabase } from './supabase';

/**
 * `./supabase` is mocked — the seam *below* the module under test, exactly as `listsApi.test.ts`
 * does it, because a module cannot be tested through a mock of itself.
 *
 * What is worth asserting here is the handful of strings and flags that decide whether anything
 * arrives at all: the topic has to be the one the `realtime.messages` policy checks, and the channel
 * has to be private or the server never evaluates that policy.
 */
jest.mock('./supabase', () => ({ supabase: { channel: jest.fn(), removeChannel: jest.fn() } }));

const USER = '8f6eade4-32d0-4dc7-8b8d-109547f2bfaf';

/** Stands in for the channel builder: `.channel(...).on(...).subscribe(...)`. */
function stubChannel() {
  const on = jest.fn();
  const subscribe = jest.fn();
  const channel = { on, subscribe };

  // Both links return the channel, because the module chains them.
  on.mockReturnValue(channel);
  subscribe.mockReturnValue(channel);
  jest.mocked(supabase.channel).mockReturnValue(channel as unknown as ReturnType<typeof supabase.channel>);

  return channel;
}

/** The broadcast handler the module registered, as Realtime would call it. */
function deliver(channel: ReturnType<typeof stubChannel>, payload?: unknown) {
  const handler = channel.on.mock.calls[0][2] as (message: unknown) => void;
  handler({ event: 'list/changed', payload });
}

/** The status callback the module passed to `subscribe`. */
function report(channel: ReturnType<typeof stubChannel>, status: string) {
  const callback = channel.subscribe.mock.calls[0][0] as (status: string) => void;
  callback(status);
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('joins the private inbox topic for the account', async () => {
  const channel = stubChannel();

  subscribeToChanges(USER, jest.fn(), jest.fn());

  expect(supabase.channel).toHaveBeenCalledWith(`user:${USER}`, { config: { private: true } });
  expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'list/changed' }, expect.any(Function));
});

it('decodes the list id from the payload', async () => {
  const channel = stubChannel();
  const onChange = jest.fn();

  subscribeToChanges(USER, onChange, jest.fn());
  deliver(channel, { listId: 'l1' });

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('l1');
});

/** A payload with no usable list id must not be mistaken for one naming an empty string or `null`. */
it.each([
  ['no payload at all', undefined],
  ['a missing listId', {}],
  ['a null listId', { listId: null }],
  ['a non-string listId', { listId: 42 }],
])('reports no list id for %s', async (_name, payload) => {
  const channel = stubChannel();
  const onChange = jest.fn();

  subscribeToChanges(USER, onChange, jest.fn());
  deliver(channel, payload);

  expect(onChange).toHaveBeenCalledWith(undefined);
});

/** The initial connect needs no repair — the caller's own mount fetch already has current truth. */
it('does not treat the first connection as a resubscribe', async () => {
  const channel = stubChannel();
  const onResubscribe = jest.fn();

  subscribeToChanges(USER, jest.fn(), onResubscribe);

  report(channel, 'CLOSED');
  report(channel, 'CHANNEL_ERROR');
  report(channel, 'SUBSCRIBED');
  expect(onResubscribe).not.toHaveBeenCalled();
});

/** A resubscribe is the repair for at-most-once delivery, so it is its own callback. */
it('reports a reconnect, and nothing else', async () => {
  const channel = stubChannel();
  const onResubscribe = jest.fn();

  subscribeToChanges(USER, jest.fn(), onResubscribe);

  report(channel, 'SUBSCRIBED');
  expect(onResubscribe).not.toHaveBeenCalled();

  report(channel, 'CLOSED');
  report(channel, 'SUBSCRIBED');
  expect(onResubscribe).toHaveBeenCalledTimes(1);
});

it('closes the channel when its caller is done with it', async () => {
  const channel = stubChannel();

  subscribeToChanges(USER, jest.fn(), jest.fn())();

  expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
});
