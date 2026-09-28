import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts } from '../theme';
import { ChevronIcon } from './icons';
import { IconButton } from './IconButton';

/**
 * Between the safe-area inset and the back button: puts the button at y 60 on the iPhone 17e, where
 * every mockup draws it — List detail's `HEADER_GAP`.
 */
const HEADER_GAP = 13;

/**
 * The drawn header of a pushed screen with nothing else in its top row — Account and Sharing: an
 * outlined round Back, then the screen's name in the serif, as List detail draws its own. The native
 * header is hidden on every screen (`RootNavigator`); back still works without it — the edge swipe on
 * iOS and the hardware back on Android belong to the stack, not the header.
 */
export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top + HEADER_GAP }}>
      <View style={styles.row}>
        <IconButton label="Back" outline={colors.outline} onPress={onBack}>
          <ChevronIcon direction="left" color={colors.text} size={18} />
        </IconButton>
      </View>
      <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  row: {
    height: 36,
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  title: {
    marginTop: 12,
    paddingHorizontal: 20,
    fontFamily: fonts.serif,
    fontSize: 40,
    lineHeight: 52,
    color: colors.text,
  },
}));
