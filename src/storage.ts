import { isSortKey } from './collection';
import { sanitizeEntry } from './io';
import type { CollectionEntry, SortKey, ViewMode } from './types';

const KEY = 'mtg-collection.v1';

export interface SavedData {
  version: 1;
  entries: CollectionEntry[];
  pricesUpdatedAt: number | null;
  view: ViewMode;
  sort: SortKey;
  importedOrderIds: string[];
}

export const EMPTY_SAVE: SavedData = {
  version: 1,
  entries: [],
  pricesUpdatedAt: null,
  view: 'grid',
  sort: 'added-desc',
  importedOrderIds: [],
};

function orderIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
  return [...new Set(ids)];
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadCollection(): SavedData {
  const storage = browserStorage();
  if (!storage) return EMPTY_SAVE;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return EMPTY_SAVE;
    const data = JSON.parse(raw) as Partial<SavedData>;
    if (!data || data.version !== 1 || !Array.isArray(data.entries)) return EMPTY_SAVE;
    return {
      version: 1,
      entries: data.entries.map((entry) => sanitizeEntry(entry)).filter((entry): entry is CollectionEntry => entry !== null),
      pricesUpdatedAt: typeof data.pricesUpdatedAt === 'number' ? data.pricesUpdatedAt : null,
      view: data.view === 'list' ? 'list' : 'grid',
      sort: isSortKey(data.sort) ? data.sort : 'added-desc',
      importedOrderIds: orderIds(data.importedOrderIds),
    };
  } catch {
    return EMPTY_SAVE;
  }
}

export function saveCollection(data: SavedData): string | null {
  const storage = browserStorage();
  if (!storage) return 'This browser will not store the collection.';
  try {
    storage.setItem(KEY, JSON.stringify(data));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not save the collection on this device.';
  }
}
