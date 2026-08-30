import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { ListsProvider } from './src/state/ListsContext';
import { SessionProvider } from './src/state/SessionContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ListsProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </ListsProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
