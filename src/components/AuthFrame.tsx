import type { ReactNode } from 'react';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { themedStyles } from '../state/ThemeContext';
import { fonts } from '../theme';
import { Backdrop } from './Backdrop';
import { Card } from './Card';
import { Landscape } from './Landscape';
import { useKeyboardReveal } from './useKeyboardReveal';

/**
 * Below the safe area's top: the app's name, and the card. The iPhone 17e's inset is 47, so these
 * put the name's capitals at y 137 and the card's top at y 372, where both mockups draw them — with
 * the sun rising between the two.
 */
const NAME_TOP = 82;
const CARD_TOP = 325;
const NAME_H = 54;

/**
 * What Sign in and Set name share: the app's name over the rising sun, the land running down the
 * screen behind, and the form on a frosted card. Both are what a new user sees first.
 *
 * The land is fixed; the name and card scroll. With the keyboard up, the whole card rides up over
 * the sun to sit just above it — the field and the button that sends it both in view
 * (`useKeyboardReveal`) — while the land stays where it is. `keyboardShouldPersistTaps` lets the first
 * tap on a button with the keyboard up press it, rather than only close the keyboard.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reveal = useKeyboardReveal();

  return (
    <Backdrop art={<Landscape />}>
      <ScrollView
        ref={reveal.ref}
        onLayout={reveal.onLayout}
        onScroll={reveal.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + NAME_TOP }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Text accessibilityRole="header" style={styles.name}>
          ShoppingLoop
        </Text>
        <Card
          style={styles.card}
          onLayout={({ nativeEvent: { layout } }) => reveal.setTarget(layout.y + layout.height)}>
          {children}
        </Card>
      </ScrollView>
    </Backdrop>
  );
}

const useStyles = themedStyles((colors) => ({
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  name: {
    height: NAME_H,
    fontFamily: fonts.serif,
    fontSize: 43,
    lineHeight: NAME_H,
    textAlign: 'center',
    color: colors.text,
  },
  card: {
    marginTop: CARD_TOP - NAME_TOP - NAME_H,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
}));
