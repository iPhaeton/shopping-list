import { Linking } from 'react-native';

import { LOCALES, PSEUDO_LOCALE, type AppLocale } from './locales';

/** What a dev link asks for: a catalog to show, or `device` to go back to the device's choice. */
export type DevLocaleTarget = AppLocale | typeof PSEUDO_LOCALE | 'device';

const TARGETS: ReadonlySet<string> = new Set([...LOCALES, PSEUDO_LOCALE, 'device']);

/**
 * `shopping-list://dev/locale/<catalog>` → that catalog; `…/device` → back to `pickLocale`. Anything
 * else — the dev client's own `exp+shopping-list://expo-development-client/…` launch link included —
 * is not ours. A regular expression rather than `URL`, whose React Native version has no `host` or
 * `pathname`.
 */
export function parseDevLocaleLink(url: string): DevLocaleTarget | null {
  const match = /^shopping-list:\/\/dev\/locale\/([A-Za-z-]+)\/?$/.exec(url);
  return match && TARGETS.has(match[1]) ? (match[1] as DevLocaleTarget) : null;
}

/**
 * Dev builds only — `index.ts` requires this file behind `__DEV__`, so a production bundle never
 * contains it. Lets a Maestro flow, which finds everything by its English label, navigate in English,
 * switch the catalog in place, shoot, and switch back. Handles both a link that arrives while the
 * app runs and one that cold-started it.
 */
export function listenForDevLocaleLinks(apply: (target: DevLocaleTarget) => void): void {
  const handle = (url: string | null) => {
    const target = url ? parseDevLocaleLink(url) : null;
    if (target) apply(target);
  };

  Linking.addEventListener('url', ({ url }) => handle(url));
  void Linking.getInitialURL().then(handle);
}
