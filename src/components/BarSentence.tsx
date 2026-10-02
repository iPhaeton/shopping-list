import { Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, radius, spacing } from '../theme';

/**
 * A sentence holding the Create / Add bar's place, on the bar's own surface — outline, shadow, the
 * 20pt inset — so the header keeps its shape when the bar is not offered and nothing below it moves.
 * Lists says so at a list limit; both screens say what the bin is while "Show deleted" is on.
 *
 * Two lines on a phone at most, so a minimum height rather than the bar's fixed one, and `radius.lg`,
 * the pill's cousin for content that tall.
 */
export function BarSentence({ children }: { children: string }) {
  const styles = useStyles();

  return (
    <View style={styles.bar}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  bar: {
    justifyContent: 'center',
    minHeight: 52,
    marginHorizontal: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceOutline,
    backgroundColor: colors.surface,
    boxShadow: `0px 3px 16px ${colors.barShadow}`,
  },
  text: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 20,
  },
}));
