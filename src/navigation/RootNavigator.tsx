import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SignOutButton } from '../components/SignOutButton';
import { ListDetailScreen } from '../screens/ListDetailScreen';
import { ListsScreen } from '../screens/ListsScreen';
import { SharingScreen } from '../screens/SharingScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { useSession, type AuthState } from '../state/SessionContext';
import { colors } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { state } = useSession();

  // Nothing is known yet about whether a stored session exists; showing either stack here would
  // flash the wrong one.
  if (state.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.background },
        }}>
        {screensFor(state)}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * A `switch` on the union rather than `session ? app : signIn`, so a further state — a biometric
 * `locked`, say — is one new case here instead of an edit to every branch point in the app.
 */
function screensFor(state: Exclude<AuthState, { status: 'loading' }>) {
  switch (state.status) {
    case 'signedOut':
      return (
        <Stack.Screen
          name="SignIn"
          component={SignInScreen}
          options={{ title: 'ShoppingLoop' }}
        />
      );
    case 'signedIn':
      return (
        <>
          <Stack.Screen
            name="Lists"
            component={ListsScreen}
            options={{ title: 'My Lists', headerRight: () => <SignOutButton /> }}
          />
          <Stack.Screen name="ListDetail" component={ListDetailScreen} />
          <Stack.Screen name="Sharing" component={SharingScreen} options={{ title: 'Sharing' }} />
        </>
      );
  }
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
