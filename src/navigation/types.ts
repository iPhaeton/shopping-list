import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Lists: undefined;
  ListDetail: { listId: string };
};

export type ListsScreenProps = NativeStackScreenProps<RootStackParamList, 'Lists'>;
export type ListDetailScreenProps = NativeStackScreenProps<RootStackParamList, 'ListDetail'>;
