export type Item = {
  id: string;
  title: string;
  done: boolean;
};

export type List = {
  id: string;
  name: string;
  items: Item[];
};

export type State = {
  lists: List[];
};

/**
 * Ids are carried on the action rather than generated inside the reducer, so the
 * reducer stays pure and deterministic. `ListsContext` mints them at dispatch time.
 */
export type Action =
  | { type: 'list/created'; id: string; name: string }
  | { type: 'item/added'; listId: string; id: string; title: string }
  | { type: 'item/toggled'; listId: string; itemId: string };
