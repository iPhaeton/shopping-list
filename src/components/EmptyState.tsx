import { Text, View } from 'react-native';

import { themedStyles } from '../state/ThemeContext';
import { fonts, spacing } from '../theme';

/**
 * `ink` overrides both lines' color — for a caller rendering this over a horizon band, where a
 * contrast-picked ink (`bandAt`, `src/state/bands.ts`) is what stays AA-legible, not the default
 * `text`/`textMuted` pair meant for a plain surface.
 */
export function EmptyState({ title, hint, ink }: { title: string; hint: string; ink?: string }) {
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, ink && { color: ink }]}>{title}</Text>
      <Text style={[styles.hint, ink && { color: ink }]}>{hint}</Text>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl * 2,
    gap: spacing.sm,
  },
  title: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 17,
    color: colors.text,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
}));
