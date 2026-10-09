import { ago } from './ago';

const THEN = '2026-10-09T12:00:00Z';
const at = (seconds: number) => Date.parse(THEN) + seconds * 1000;

/** Every boundary, each side of it — rounded down throughout, so 24 to 48 hours is `1 d ago`. */
it.each([
  [0, 'just now'],
  [59, 'just now'],
  [60, '1 min ago'],
  [59 * 60 + 59, '59 min ago'],
  [60 * 60, '1 h ago'],
  [24 * 3600 - 1, '23 h ago'],
  [24 * 3600, '1 d ago'],
  [48 * 3600 - 1, '1 d ago'],
  [48 * 3600, '2 d ago'],
  [30 * 24 * 3600, '30 d ago'],
])('%i s after reads %s', (seconds, text) => {
  expect(ago(THEN, at(seconds))).toBe(text);
});

/** This device's clock behind the server's must not print a negative age. */
it('reads a stamp from the future as just now', () => {
  expect(ago(THEN, at(-90))).toBe('just now');
});
