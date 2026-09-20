import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  /** Only mounted while signed out — see `screensFor` in RootNavigator. */
  SignIn: undefined;
  Lists: undefined;
  ListDetail: { listId: string };
  /** Who else has access. Reachable by every member, not only by an owner. */
  Sharing: { listId: string };
  Account: undefined;
};

export type SignInScreenProps = NativeStackScreenProps<RootStackParamList, 'SignIn'>;
export type ListsScreenProps = NativeStackScreenProps<RootStackParamList, 'Lists'>;
export type ListDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'ListDetail'>;
export type SharingScreenProps = NativeStackScreenProps<RootStackParamList, 'Sharing'>;
export type AccountScreenProps = NativeStackScreenProps<RootStackParamList, 'Account'>;
