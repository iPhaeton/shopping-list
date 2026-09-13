import { useCallback, type Dispatch } from 'react';

import { newId } from '../lib/ids';
import { canEditItems, canManageList } from './roles';
import type { Action, List, WriteAction } from './types';

/**
 * The seven writes a person can trigger from the screens — dispatched optimistically, then handed
 * to `enqueueOp` for the outbox. Split out of `ListsContext` because every one of these follows the
 * same shape (validate, check the role, build an absolute-valued `WriteAction`) and none of them
 * touches the outbox/fetch machinery directly; they only need `lists` to check a role and `dispatch`
 * plus `enqueueOp` to act.
 */
export function useListWrites({
  lists,
  dispatch,
  enqueueOp,
  setError,
}: {
  lists: List[];
  dispatch: Dispatch<Action>;
  enqueueOp: (op: WriteAction) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const createList = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      const id = newId();
      const op: WriteAction = { type: 'list/created', id, name: trimmed };
      dispatch(op);
      void enqueueOp(op);
      return id;
    },
    [enqueueOp]
  );

  /**
   * No id to mint — the list already has one. Renaming is an absolute value like a toggle, so a
   * retry cannot double-apply it and a queued rename can be replaced by a newer one.
   */
  const renameList = useCallback(
    (listId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      const list = lists.find((candidate) => candidate.id === listId);
      if (!list) return;
      if (!canManageList(list.role)) {
        setError('Only an owner can rename this list.');
        return;
      }

      const op: WriteAction = { type: 'list/renamed', id: listId, name: trimmed };
      dispatch(op);
      void enqueueOp(op);
    },
    [lists, enqueueOp]
  );

  const addItem = useCallback(
    (listId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const list = lists.find((candidate) => candidate.id === listId);
      if (!list) return;
      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      const op: WriteAction = { type: 'item/added', listId, id: newId(), title: trimmed };
      dispatch(op);
      void enqueueOp(op);
    },
    [lists, enqueueOp]
  );

  /**
   * `renameList` one rung down: whoever may add an item may rename one. Same shape too — no id to
   * mint, an absolute value, so a retry cannot double-apply and a queued rename is replaced by a
   * newer one rather than sent twice.
   */
  const renameItem = useCallback(
    (listId: string, itemId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;

      const list = lists.find((candidate) => candidate.id === listId);
      const item = list?.items.find((candidate) => candidate.id === itemId);
      if (!list || !item) return;
      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      const op: WriteAction = { type: 'item/renamed', listId, itemId, title: trimmed };
      dispatch(op);
      void enqueueOp(op);
    },
    [lists, enqueueOp]
  );

  const toggleItem = useCallback(
    (listId: string, itemId: string) => {
      const list = lists.find((candidate) => candidate.id === listId);
      const item = list?.items.find((candidate) => candidate.id === itemId);
      if (!list || !item) return;

      // Unreachable from the UI, which hides the controls a reader may not use. Written anyway,
      // because the next screen to call these will not remember the rule.
      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      // The target state, computed here and sent whole. The reducer is never asked to flip, which
      // is also what makes a queued toggle safe to replace with a newer one.
      const done = item.doneAt === null;

      // A placeholder for the optimistic row only — this device's clock does not decide when an
      // item was checked off. The database stamps the real instant, and the next hydration replaces
      // what is dispatched here.
      const doneAt = done ? new Date().toISOString() : null;

      const op: WriteAction = { type: 'item/setDone', listId, itemId, doneAt };
      dispatch(op);
      void enqueueOp(op);
    },
    [lists, enqueueOp]
  );

  /**
   * Putting a list in the bin, and taking it back out. Owners only, matching `set_list_deleted`.
   *
   * Like every other write here the value is absolute and the timestamp is a placeholder for the
   * optimistic row: the database stamps the real one, and the next hydration replaces this. That
   * matters more than it does for `doneAt`, because the stored instant is what the nightly purge
   * measures its thirty days against.
   */
  const setListDeleted = useCallback(
    (listId: string, deleted: boolean) => {
      const list = lists.find((candidate) => candidate.id === listId);
      if (!list) return;
      if (!canManageList(list.role)) {
        setError('Only an owner can delete or restore this list.');
        return;
      }

      const op: WriteAction = {
        type: 'list/setDeleted',
        id: listId,
        deletedAt: deleted ? new Date().toISOString() : null,
      };
      dispatch(op);
      void enqueueOp(op);
    },
    [lists, enqueueOp]
  );

  /** The same one rung down: whoever may add an item may bin one, and may bring it back. */
  const setItemDeleted = useCallback(
    (listId: string, itemId: string, deleted: boolean) => {
      const list = lists.find((candidate) => candidate.id === listId);
      const item = list?.items.find((candidate) => candidate.id === itemId);
      if (!list || !item) return;

      if (!canEditItems(list.role)) {
        setError('You have read-only access to this list.');
        return;
      }

      const op: WriteAction = {
        type: 'item/setDeleted',
        listId,
        itemId,
        deletedAt: deleted ? new Date().toISOString() : null,
      };
      dispatch(op);
      void enqueueOp(op);
    },
    [lists, enqueueOp]
  );

  return { createList, renameList, addItem, renameItem, toggleItem, setListDeleted, setItemDeleted };
}
