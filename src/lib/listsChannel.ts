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
 * id and nothing about the change, so there is nothing here to decode: `onChange` means "re-read",
 * which is a code path the app already has. See the migration for why the payload is deliberately
 * this thin.
 *
 * `private: true` is what makes the server evaluate the `realtime.messages` select policy at join —
 * without it the channel is a public room anyone could listen to. supabase-js re-authenticates the
 * socket itself on `SIGNED_IN` / `TOKEN_REFRESHED` (`RealtimeChannel.subscribe` calls
 * `socket.setAuth()`), so there is no token handling to write here.
 */
export function subscribeToChanges(
  userId: string,
  onChange: () => void,
  /**
   * Fired on every `SUBSCRIBED`, **including reconnects**, and it is not the same event as a change.
   * Delivery is at-most-once: anything the database sent while the socket was down is gone, with no
   * queue, no ack and no redelivery. A re-read on resubscribe is the repair.
   */
  onResubscribe: () => void
): () => void {
  const channel = supabase
    .channel(`user:${userId}`, { config: { private: true } })
    .on('broadcast', { event: 'list/changed' }, () => onChange())
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onResubscribe();
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
