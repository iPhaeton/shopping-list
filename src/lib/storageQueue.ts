/**
 * One promise chain for every write this app makes to AsyncStorage.
 *
 * The outbox is serialised whole on every change, so two writes racing can interleave into a torn
 * value — and a torn outbox is a lost row. Chaining also orders `clearCachedLists` after any cache
 * write still in flight, so signing out cannot leave behind the copy it just removed.
 */
let tail: Promise<unknown> = Promise.resolve();

export function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work);
  // The caller still sees the rejection; the chain must not stay rejected for everyone behind it.
  tail = next.catch(() => undefined);
  return next;
}
