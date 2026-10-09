import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { ListsProvider } from './src/state/ListsContext';
import { NotificationsProvider } from './src/state/NotificationsContext';
import { SessionProvider, useSession } from './src/state/SessionContext';
import { SortProvider } from './src/state/SortContext';
import { ThemeProvider, useTheme } from './src/state/ThemeContext';

/**
 * The native launch screen stays up until the app's first screen is fully drawn — `hideSplash`
 * (`src/navigation/splash.ts`), called from `RootNavigator`, which renders only once `ThemeProvider`'s
 * gate has read the preference and the fonts, so what it uncovers is already in the right theme. The
 * launch screen itself follows the device's appearance until JS sets the app's own; what this rules
 * out is anything in between, like the root view in last session's colour. `SortProvider` gates the
 * same way, on the remembered sorts, so no list is ever drawn in an order it then leaves.
 */
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 250 });

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SortProvider>
          <SessionProvider>
            <ListsForSignedInUser>
              <ThemedStatusBar />
              <RootNavigator />
            </ListsForSignedInUser>
          </SessionProvider>
        </SortProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Dark icons on the day sky, light ones on the night sky. */
function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * The list provider exists only while somebody is signed in. That is what lets it fetch on mount
 * without consulting the session, and what discards one account's lists on sign-out: the provider
 * unmounts and its state goes with it. `key` covers the case of a different account signing in
 * without the first provider ever unmounting.
 *
 * The same id also goes in as a prop, because the outbox and the cached rows are stored per user
 * and two accounts share one device's disk.
 *
 * The unread count lives inside it for the same reason, and hears the database through its channel.
 */
function ListsForSignedInUser({ children }: { children: ReactNode }) {
  const { state, signOut } = useSession();

  if (state.status !== 'signedIn') return <>{children}</>;

  const userId = state.session.user.id;
  return (
    <ListsProvider key={userId} userId={userId} onSessionRevoked={() => void signOut('revoked')}>
      <NotificationsProvider>{children}</NotificationsProvider>
    </ListsProvider>
  );
}
