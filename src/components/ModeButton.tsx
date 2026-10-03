import { View } from 'react-native';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { radius } from '../theme';
import { IconButton } from './IconButton';
import { PlusIcon, SearchIcon } from './icons';

/**
 * The header button that swaps a screen's slot between search and create. **Its glyph names the
 * other mode**: Plus while search shows (`New list` / `New item`), the magnifier while the Create /
 * Add bar does (`Search and sort`).
 *
 * In create mode the query still filters and the sort still applies, but neither the field nor the
 * sort buttons show, so a `primary` dot on the magnifier says one of them is in effect, and
 * `summary` spells out which. Search mode needs no dot: the lit buttons say it.
 */
export function ModeButton({
  mode,
  newLabel,
  dot,
  summary,
  onPress,
}: {
  mode: 'search' | 'create';
  /** `New list` or `New item`. */
  newLabel: string;
  dot: boolean;
  summary?: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  if (mode === 'search') {
    return (
      <IconButton label={newLabel} outline={colors.outline} onPress={onPress}>
        <PlusIcon color={colors.text} size={18} />
      </IconButton>
    );
  }

  return (
    <IconButton label="Search and sort" value={summary} outline={colors.outline} onPress={onPress}>
      <SearchIcon color={colors.text} size={18} />
      {dot ? <View style={styles.dot} /> : null}
    </IconButton>
  );
}

const useStyles = themedStyles((colors) => ({
  // 12pt overall, its ring in `skyTop` so it reads as cut out of the outline it sits on.
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.skyTop,
    backgroundColor: colors.primary,
  },
}));
