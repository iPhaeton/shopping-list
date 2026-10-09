const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `iso` was, as Notifications and Sharing's Invited section print it: `just now`, then
 * `5 min ago`, `2 h ago`, `3 d ago` — each rounded down, so 24 to 48 hours is `1 d ago`. A stamp in
 * the future (this device's clock behind the server's) reads `just now`.
 *
 * Built by hand rather than with `Intl.RelativeTimeFormat`, for the reason `grouped` in `limits.ts`
 * gives: `Intl` is not there in every JS engine the app runs in. `now` is a parameter, so this stays
 * pure and its boundaries testable.
 */
export function ago(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);

  if (!(elapsed >= MINUTE)) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  return `${Math.floor(elapsed / DAY)} d ago`;
}
