import { useLingui } from '@lingui/react/macro';

import type { Role } from '../state/types';
import { SegmentedPicker, type SegmentedOption } from './SegmentedPicker';

type Props = {
  value: Role;
  /**
   * How to name one option, so two pickers on the same screen never collide in a query:
   * `Share as reader` in Sharing's header, `Set bob@example.com to writer` on a member row.
   */
  labelFor: (role: Role) => string;
  disabled?: boolean;
  /** A member card's picker is the card's own (`card`); the invite role's sits on the header's
   * sky. */
  track?: 'card' | 'surface';
  size?: 'regular' | 'compact' | 'small';
  onChange: (role: Role) => void;
};

export function RolePicker({ value, labelFor, disabled = false, track, size, onChange }: Props) {
  const { t } = useLingui();
  // Declaration order, weakest first — the same order the database's enum is written in. Built in
  // render, so the titles are in the language active now.
  const roles: SegmentedOption<Role>[] = [
    {
      value: 'reader',
      title: t({
        comment:
          'Role picker option (noun): a member who can only see the list. Fits about 7 characters: the picker is three equal segments in a narrow space.',
        message: 'Reader',
      }),
    },
    {
      value: 'writer',
      title: t({
        comment:
          'Role picker option (noun): a member who can add, tick off and rename items. Fits about 7 characters: the picker is three equal segments in a narrow space.',
        message: 'Writer',
      }),
    },
    {
      value: 'owner',
      title: t({
        comment:
          'Role picker option (noun): a member who can also rename, share and delete the list. Fits about 7 characters: the picker is three equal segments in a narrow space.',
        message: 'Owner',
      }),
    },
  ];

  return (
    <SegmentedPicker
      options={roles}
      value={value}
      labelFor={labelFor}
      disabled={disabled}
      track={track}
      size={size}
      onChange={onChange}
    />
  );
}
