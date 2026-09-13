import { supabase } from './supabase';

/**
 * The one live connection: your own inbox topic, where the database drops a nudge whenever a list you
 * belong to changes.
 *
 * A module beside `listsApi` rather than inside it, because a subscription is not a query — it has a
 * lifetime, and that module's promise is "every read and write of list data". The seam is the same
 * one: this imports the client from `./supabase`, never `@supabase/supabase-js`, so a test mocks one
 * plain function and no websocket is ever opened under jest.
 *
 * **The message is a nudge, and answering it is the caller's business.** The payload carries a list
 * id and nothing about *what* changed, so `onChange` decodes only that much: it means "re-read this
 * list", which is a code path the app already has. See the migration for why the rest of the payload
 * is deliberately left undecoded.
 *
 * `private: true` is what makes the server evaluate the `realtime.messages` select policy at join —
 * without it the channel is a public room anyone could listen to. supabase-js re-authenticates the
 * socket itself on `SIGNED_IN` / `TOKEN_REFRESHED` (`RealtimeChannel.subscribe` calls
 * `socket.setAuth()`), so there is no token handling to write here.
 */
export function subscribeToChanges(
  userId: string,
  /** `undefined` when the payload carries no usable list id — a malformed or missing one. */
  onChange: (listId?: string) => void,
  /**
   * Fired on a reconnect — a `SUBSCRIBED` after one already happened on this channel — never the
   * initial connect. Delivery is at-most-once: anything the database sent while the socket was down
   * is gone, with no queue, no ack and no redelivery. A re-read on resubscribe is the repair, and it
   * can never know what it missed, so it never carries a list id. The first connect needs no repair:
   * nothing could have been missed before the channel existed, and the caller's own mount fetch
   * already has current truth.
   */
  onResubscribe: () => void
): () => void {
  // Sees only whether this channel has ever reached `SUBSCRIBED` before, not whether it is currently
  // connected — a second `SUBSCRIBED` on the same instance is a reconnect by definition, since the
  // channel had to drop and rejoin to report it again.
  let connected = false;

  const channel = supabase
    .channel(`user:${userId}`, { config: { private: true } })
    .on('broadcast', { event: 'list/changed' }, (message: { payload?: { listId?: unknown } }) => {
      const { listId } = message.payload ?? {};
      onChange(typeof listId === 'string' ? listId : undefined);
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      if (connected) onResubscribe();
      connected = true;
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
