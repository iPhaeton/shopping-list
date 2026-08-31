/**
 * `expo-crypto`'s `randomUUID` is a native call, and jest-expo mocks native modules away. It
 * returns `undefined` under jest rather than throwing, which would hand every row the same id and
 * fail somewhere far from the cause. Node's implementation is a faithful stand-in.
 *
 * `require` inside the factory rather than a top-level import: jest hoists `jest.mock` above the
 * imports, so a factory may not close over them.
 */
jest.mock('expo-crypto', () => ({
  randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID(),
}));
