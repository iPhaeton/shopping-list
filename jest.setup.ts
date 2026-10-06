/**
 * `expo-crypto`'s `randomUUID` is a native call, and jest-expo mocks native modules away. It
 * returns `undefined` under jest rather than throwing, which would hand every row the same id and
 * fail somewhere far from the cause. Node's implementation is a faithful stand-in. The same goes for
 * `digestStringAsync`, which hashes Apple's sign-in nonce: Node's SHA-256 lets a test check the real
 * hash. Only SHA-256 in hex — the default encoding — is used.
 *
 * `require` inside the factory rather than a top-level import: jest hoists `jest.mock` above the
 * imports, so a factory may not close over them.
 */
jest.mock('expo-crypto', () => {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return {
    randomUUID: () => crypto.randomUUID(),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (algorithm: string, data: string) => {
      if (algorithm !== 'SHA-256') throw new Error(`Unmocked digest algorithm: ${algorithm}`);
      return crypto.createHash('sha256').update(data).digest('hex');
    },
  };
});

/**
 * The outbox and the list cache live in AsyncStorage, whose native module jest-expo mocks away.
 * The library ships an in-memory stand-in for exactly this; suites that touch storage clear it
 * between tests rather than mocking the two modules above it, so what is asserted is the real
 * round trip through disk.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

/**
 * `useSafeAreaInsets()`/`useSafeAreaFrame()` throw with no `SafeAreaProvider` above them
 * (`NO_INSETS_ERROR`), and screen suites render a screen directly rather than the app's full
 * provider tree. The library ships a mock built for exactly this: it falls back to a fixed
 * `initialWindowMetrics` (all insets 0) instead of throwing, and still honours a real provider a
 * suite chooses to add above the screen under test.
 */
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);
