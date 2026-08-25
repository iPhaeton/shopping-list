import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ListDetailScreen } from '../screens/ListDetailScreen';
import { ListsScreen } from '../screens/ListsScreen';
import { colors } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}>
        <Stack.Screen name="Lists" component={ListsScreen} options={{ title: 'My Lists' }} />
        <Stack.Screen name="ListDetail" component={ListDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
