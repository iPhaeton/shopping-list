import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { themedStyles, useTheme } from '../state/ThemeContext';
import { fonts } from '../theme';
import { ChevronIcon } from './icons';
import { IconButton } from './IconButton';

/**
 * Between the safe-area inset and the back button: puts the button at y 60 on the iPhone 17e, where
 * every mockup draws it — List detail's `HEADER_GAP`, and Sharing's pinned header's.
 */
export const HEADER_GAP = 13;

/**
 * The drawn header of a pushed screen — Account, Notifications, Blocked people: an outlined round
 * Back, then the screen's name in the serif, as List detail draws its own. `right` sits opposite
 * Back in the same 36pt row — Notifications' `Blocked people` pill. The native header is hidden on
 * every screen (`RootNavigator`); back still works without it — the edge swipe on iOS and the
 * hardware back on Android belong to the stack, not the header.
 */
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top + HEADER_GAP }}>
      <View style={styles.row}>
        <IconButton label="Back" outline={colors.outline} onPress={onBack}>
          <ChevronIcon direction="left" color={colors.text} size={18} />
        </IconButton>
        {right}
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
    alignItems: 'center',
    justifyContent: 'space-between',
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
