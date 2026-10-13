import { plural, t } from '@lingui/core/macro';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `iso` was, as Notifications and Sharing's Invited section print it: `just now`, then
 * `5 min ago`, `2 h ago`, `3 d ago` — each rounded down, so 24 to 48 hours is `1 d ago`. A stamp in
 * the future (this device's clock behind the server's) reads `just now`.
 *
 * Four plural messages rather than `Intl.RelativeTimeFormat`, which Hermes does not have and the
 * app does not polyfill (D9). `now` is a parameter, so this stays pure and its boundaries testable.
 */
export function ago(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);

  if (!(elapsed >= MINUTE)) {
    return t({ comment: 'How long ago something happened: under a minute. Shown in small print beside other text.', message: 'just now' });
  }
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return t({
      comment: 'How long ago something happened, in whole minutes, abbreviated: short, small print beside other text.',
      message: plural(minutes, { other: '# min ago' }),
    });
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return t({
      comment: 'How long ago something happened, in whole hours, abbreviated: short, small print beside other text.',
      message: plural(hours, { other: '# h ago' }),
    });
  }
  const days = Math.floor(elapsed / DAY);
  return t({
    comment: 'How long ago something happened, in whole days, abbreviated: short, small print beside other text.',
    message: plural(days, { other: '# d ago' }),
  });
}
