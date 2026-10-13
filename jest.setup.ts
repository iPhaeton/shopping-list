import { i18n } from '@lingui/core';

import { messages as enMessages } from './src/locales/en/messages';

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

/**
 * Jest runs in English: the `en` catalog, active before any suite renders or calls a helper. A
 * message outside React (`t`/`msg` from `@lingui/core/macro`) reads the global `i18n` directly, so
 * the activation is here rather than in a provider. Activated explicitly, not through
 * `pickLocale(getLocales())`, so the mocked device's language can never change what suites assert.
 *
 * A suite that calls `jest.resetModules()` gets a fresh `@lingui/core` whose `i18n` has no locale;
 * one that then renders translated text must activate it again.
 */
i18n.loadAndActivate({ locale: 'en', messages: enMessages });

/**
 * `useLingui()` and `<Trans>` throw with no `I18nProvider` above them, and screen suites render a
 * screen directly rather than the app's provider tree — the same gap as the safe-area mock above.
 * Without a provider, both fall back to the global `i18n` activated just above; a real provider a
 * suite chooses to add still wins.
 */
jest.mock('@lingui/react', () => {
  const React = require('react') as typeof import('react');
  const actual = jest.requireActual('@lingui/react') as typeof import('@lingui/react');
  const { i18n: global } = require('@lingui/core') as typeof import('@lingui/core');

  const fallback = { i18n: global, _: global.t.bind(global) };

  function useLingui() {
    return React.useContext(actual.LinguiContext) ?? fallback;
  }

  function Trans(props: Parameters<typeof actual.Trans>[0]) {
    const context = React.useContext(actual.LinguiContext);
    const trans = React.createElement(actual.Trans, props);
    return context ? trans : React.createElement(actual.LinguiContext.Provider, { value: fallback }, trans);
  }

  return { ...actual, useLingui, Trans };
});
