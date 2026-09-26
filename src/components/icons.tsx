import { Circle, Path, Svg } from 'react-native-svg';

type IconProps = {
  color: string;
  size?: number;
};

/** A trash can, open lid: the delete action on a live row. */
export function TrashIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M10 11v6M14 11v6" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** A counter-clockwise arrow: bring a binned row back. */
export function RestoreIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 10a7.5 7.5 0 1 1 1.9 6.6"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4.5 5v5h5" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** The row's own affordance to open it. */
export function ChevronIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5l7 7-7 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** An outline cloud, in the sync banner. */
export function CloudIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 18a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17.2 8.1 4 4 0 0 1 16.5 16H7z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Two overlapping puffs, the sync banner's decoration rising from its own top-left corner. */
export function CloudPuff({ color, width = 50, height = 22 }: { color: string; width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 50 22" fill="none">
      <Circle cx={16} cy={15} r={12} fill={color} />
      <Circle cx={32} cy={17} r={9} fill={color} />
    </Svg>
  );
}
