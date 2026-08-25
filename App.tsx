import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { ListsProvider } from './src/state/ListsContext';

export default function App() {
  return (
    <SafeAreaProvider>
      <ListsProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </ListsProvider>
    </SafeAreaProvider>
  );
}
