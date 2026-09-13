import {
  addItem as addItemRequest,
  insertList,
  renameItem as renameItemRequest,
  renameList as renameListRequest,
  setItemDeleted as setItemDeletedRequest,
  setItemDone,
  setListDeleted as setListDeletedRequest,
  type Result,
} from '../lib/listsApi';
import type { WriteAction } from './types';

/**
 * The queued action carries everything the request needs, so this is the whole mapping from "a
 * write" to "a call". The boolean is derived rather than stored: `doneAt` on the action is the
 * optimistic row's placeholder, and only the database's clock decides the real one.
 */
export function sendWrite(op: WriteAction): Promise<Result> {
  switch (op.type) {
    case 'list/created':
      return insertList(op.id, op.name);

    case 'list/renamed':
      return renameListRequest(op.id, op.name);

    case 'list/setDeleted':
      return setListDeletedRequest(op.id, op.deletedAt !== null);

    case 'item/added':
      return addItemRequest(op.id, op.listId, op.title);

    case 'item/renamed':
      return renameItemRequest(op.itemId, op.title);

    case 'item/setDone':
      return setItemDone(op.itemId, op.doneAt !== null);

    // The boolean is derived at send time, exactly as `doneAt` is: what is queued is the value the
    // row should have, so a coalesced delete-then-restore sends one request saying "not deleted".
    case 'item/setDeleted':
      return setItemDeletedRequest(op.itemId, op.deletedAt !== null);
  }
}
