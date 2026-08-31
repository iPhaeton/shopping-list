import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { ListsProvider } from './src/state/ListsContext';
import { SessionProvider, useSession } from './src/state/SessionContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ListsForSignedInUser>
          <StatusBar style="dark" />
          <RootNavigator />
        </ListsForSignedInUser>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * The list provider exists only while somebody is signed in. That is what lets it fetch on mount
 * without consulting the session, and what discards one account's lists on sign-out: the provider
 * unmounts and its state goes with it. `key` covers the case of a different account signing in
 * without the first provider ever unmounting.
 */
function ListsForSignedInUser({ children }: { children: ReactNode }) {
  const { state } = useSession();

  if (state.status !== 'signedIn') return <>{children}</>;

  return <ListsProvider key={state.session.user.id}>{children}</ListsProvider>;
}
