import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useSession } from '../state/SessionContext';
import { colors, spacing } from '../theme';

/**
 * Lives in the `Lists` header, wired up by `RootNavigator` rather than by `ListsScreen` — which
 * keeps the screen and its tests free of any session dependency.
 */
export function SignOutButton() {
  const { signOut } = useSession();
  const [pending, setPending] = useState(false);

  async function press() {
    setPending(true);

    const { error } = await signOut();

    // On success the navigator swaps stacks and this button unmounts. On failure the session is
    // still live, so re-enable and let the user try again.
    if (error) setPending(false);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      accessibilityState={{ disabled: pending }}
      disabled={pending}
      onPress={press}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={styles.text}>Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    color: colors.accent,
    fontSize: 16,
  },
});
