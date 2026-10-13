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

/**
 * Web's way in, dev builds only, for the same purpose: there `Linking` only ever sees the page's own
 * http URL, so no link can reach the app. A Playwright session calls `__setDevLocale('pseudo')` —
 * `'device'` to go back — and the page switches in place, exactly as a link would switch it. Answers
 * whether the target was one of ours.
 */
export function exposeDevLocaleSwitch(apply: (target: DevLocaleTarget) => void): void {
  (globalThis as { __setDevLocale?: (target: string) => boolean }).__setDevLocale = (target) => {
    const parsed = parseDevLocaleLink(`shopping-list://dev/locale/${target}`);
    if (parsed) apply(parsed);
    return parsed !== null;
  };
}
