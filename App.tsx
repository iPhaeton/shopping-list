import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { ListsProvider } from './src/state/ListsContext';
import { SessionProvider, useSession } from './src/state/SessionContext';
import { ThemeProvider, useTheme } from './src/state/ThemeContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <ListsForSignedInUser>
            <ThemedStatusBar />
            <RootNavigator />
          </ListsForSignedInUser>
        </SessionProvider>
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
 */
function ListsForSignedInUser({ children }: { children: ReactNode }) {
  const { state, signOut } = useSession();

  if (state.status !== 'signedIn') return <>{children}</>;

  const userId = state.session.user.id;
  return (
    <ListsProvider key={userId} userId={userId} onSessionRevoked={() => void signOut('revoked')}>
      {children}
    </ListsProvider>
  );
}
