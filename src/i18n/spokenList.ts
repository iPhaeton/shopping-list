import { t } from '@lingui/core/macro';

/**
 * Parts of one `accessibilityValue` read out as a list — `Searching mi, A to Z, oldest first` — each
 * part a whole message of its own, joined by the language's own separator. A list rather than a
 * sentence, so this is the one place translated pieces are put side by side.
 */
export function spokenList(parts: readonly string[]): string {
  return parts.join(
    t({
      comment:
        'VoiceOver only: the separator between the parts of a list read aloud, e.g. "Unread, Maya invited you to Picnic, 2 min ago". English is a comma and a space.',
      message: ', ',
    })
  );
}
