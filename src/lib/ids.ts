import { randomUUID } from 'expo-crypto';

/**
 * Ids for rows the client creates before the database has seen them.
 *
 * A UUID rather than the counter this used to be (`list-1`, `item-1`): ids are primary keys in a
 * table shared by every account now, and two devices both minting `item-3` would collide. Knowing
 * the id up front is also what makes the optimistic write work — the row can be rendered before the
 * insert returns, and a retried insert is idempotent rather than duplicating.
 *
 * Behind its own module because `randomUUID` is a native call on device: this is the single place
 * that platform dependency is touched, and jest replaces it here (see `jest.setup.ts`).
 */
export function newId(): string {
  return randomUUID();
}
