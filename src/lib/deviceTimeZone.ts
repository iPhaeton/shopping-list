/**
 * The device's IANA zone name (`Europe/Warsaw`), or `null` when the platform will not say. Read
 * fresh each time: it changes when the phone crosses a border. A module of its own so suites can
 * mock it without reaching into `Intl`.
 */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
