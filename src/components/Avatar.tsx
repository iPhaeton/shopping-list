import { Text, View } from 'react-native';

import { bandAt } from '../state/bands';
import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts, radius } from '../theme';

/** How many of the lightest bands an avatar may take: past the third, by day, they turn dark. */
const AVATAR_BANDS = 3;

/** A small stable hash, so a person keeps their color wherever they appear and across renders. */
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * A person's initial on a disc in one of the first three horizon bands — picked by their account id,
 * not their place in a list, so the same person is the same color on their member card and in the
 * invite suggestions. The initial takes the band's own contrast-picked ink. Purely decorative: the
 * name beside it is what a screen reader reads.
 */
export function Avatar({ id, name, size = 36 }: { id: string; name: string; size?: 36 | 30 }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const band = bandAt(colors, hash(id) % AVATAR_BANDS);

  return (
    <View
      style={[styles.disc, { width: size, height: size, backgroundColor: band.color }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Text style={[size === 36 ? styles.initial : styles.initialSmall, { color: band.ink }]}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const useStyles = themedStyles(() => ({
  disc: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
  },
  initialSmall: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
}));
