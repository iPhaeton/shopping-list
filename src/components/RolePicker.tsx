import type { Role } from '../state/types';
import { SegmentedPicker, type SegmentedOption } from './SegmentedPicker';

/** Declaration order, weakest first — the same order the database's enum is written in. */
const ROLES: SegmentedOption<Role>[] = [
  { value: 'reader', title: 'Reader' },
  { value: 'writer', title: 'Writer' },
  { value: 'owner', title: 'Owner' },
];

type Props = {
  value: Role;
  /**
   * How to name one option, so two pickers on the same screen never collide in a query:
   * `Share as reader` in the invite form, `Set bob@example.com to writer` on a member row.
   */
  labelFor: (role: Role) => string;
  disabled?: boolean;
  /** A member card's picker is the card's own (`card`); the invite form's sits on the sky. */
  track?: 'card' | 'surface';
  size?: 'regular' | 'compact';
  onChange: (role: Role) => void;
};

export function RolePicker({ value, labelFor, disabled = false, track, size, onChange }: Props) {
  return (
    <SegmentedPicker
      options={ROLES}
      value={value}
      labelFor={labelFor}
      disabled={disabled}
      track={track}
      size={size}
      onChange={onChange}
    />
  );
}
