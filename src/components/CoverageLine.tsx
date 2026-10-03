import { Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';
import { PillButton } from './PillButton';

/**
 * A quiet line under the search slot, on the sky: how much of a stream the results cover while it
 * is being completed, or could not be — with `Try again` when a page failed. List detail's
 * read-only sentence borrows the same style, below it.
 *
 * Up to two lines; `Try again` keeps its width at the right.
 */
export function CoverageLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const styles = useStyles();

  return (
    <View style={styles.row}>
      <Text style={styles.text}>{text}</Text>
      {onRetry ? <PillButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 10,
    paddingLeft: 24,
    paddingRight: 20,
  },
  // `textSecondary`, not `textMuted`: this is body text on the sky, and it has to meet AA there.
  text: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
  },
}));
