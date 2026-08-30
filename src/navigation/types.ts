import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  /** Only mounted while signed out — see `screensFor` in RootNavigator. */
  SignIn: undefined;
  Lists: undefined;
  ListDetail: { listId: string };
};

export type SignInScreenProps = NativeStackScreenProps<RootStackParamList, 'SignIn'>;
export type ListsScreenProps = NativeStackScreenProps<RootStackParamList, 'Lists'>;
export type ListDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'ListDetail'>;
