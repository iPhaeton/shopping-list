import { i18n, type Messages } from '@lingui/core';
import { getLocales } from 'expo-localization';
import { AppState } from 'react-native';

import { messages as be } from '../locales/be/messages';
import { messages as bg } from '../locales/bg/messages';
import { messages as cs } from '../locales/cs/messages';
import { messages as de } from '../locales/de/messages';
import { messages as en } from '../locales/en/messages';
import { messages as es } from '../locales/es/messages';
import { messages as fi } from '../locales/fi/messages';
import { messages as fr } from '../locales/fr/messages';
import { messages as hr } from '../locales/hr/messages';
import { messages as hu } from '../locales/hu/messages';
import { messages as it } from '../locales/it/messages';
import { messages as nb } from '../locales/nb/messages';
import { messages as pl } from '../locales/pl/messages';
import { messages as ptPT } from '../locales/pt-PT/messages';
import { messages as ru } from '../locales/ru/messages';
import { messages as sk } from '../locales/sk/messages';
import { messages as sl } from '../locales/sl/messages';
import { messages as srCyrl } from '../locales/sr-Cyrl/messages';
import { messages as srLatn } from '../locales/sr-Latn/messages';
import { messages as sv } from '../locales/sv/messages';
import { messages as uk } from '../locales/uk/messages';
import type { DevLocaleTarget } from './devLink';
import { PSEUDO_LOCALE, pickLocale, type AppLocale } from './locales';

/**
 * Every catalog is bundled and loaded up front — a few kilobytes each — so switching never waits on
 * anything. Typed by `AppLocale`, so a catalog added to `locales.ts` and not here fails to compile.
 */
const catalogs: Record<AppLocale, Messages> = {
  en,
  de,
  fr,
  es,
  it,
  'pt-PT': ptPT,
  sv,
  nb,
  fi,
  pl,
  cs,
  sk,
  sl,
  hr,
  hu,
  'sr-Cyrl': srCyrl,
  'sr-Latn': srLatn,
  be,
  ru,
  uk,
  bg,
};
i18n.load(catalogs);

/** Set by a dev link, and held until `…/device` clears it: a foreground must not undo a switch
 * made to shoot a screen. Always null in production, where no link can set it. */
let devOverride: Exclude<DevLocaleTarget, 'device'> | null = null;

function show(locale: string) {
  if (i18n.locale !== locale) i18n.activate(locale);
}

function followDevice() {
  if (devOverride === null) show(pickLocale(getLocales()));
}

// At module load, before the first render, so the first frame is already in the device's language.
followDevice();

// iOS relaunches the app when its language changes, so this is for Android and web, where a change
// can reach a running app. `getLocales()` is read fresh each time, as expo-localization advises.
AppState.addEventListener('change', (state) => {
  if (state === 'active') followDevice();
});

// `__DEV__` is a constant Metro folds away in a production bundle, `require`s included — so neither
// the pseudo catalog nor the link handler ships.
if (__DEV__) {
  i18n.load(PSEUDO_LOCALE, require('../locales/pseudo/messages').messages as Messages);

  const { listenForDevLocaleLinks } = require('./devLink') as typeof import('./devLink');
  listenForDevLocaleLinks((target) => {
    devOverride = target === 'device' ? null : target;
    if (devOverride === null) followDevice();
    else show(devOverride);
  });
}

export { i18n };
