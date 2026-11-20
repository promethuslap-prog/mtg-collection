import { isSortKey } from './collection';
import { sanitizeEntry } from './io';
import type { CollectionEntry, SortKey, ViewMode } from './types';

const KEY = 'mtg-collection.v1';

export interface BinderState {
  manualEntries: CollectionEntry[];
  layerMoxfield: CollectionEntry[];
  layerTcgplayer: CollectionEntry[];
  layerPurchases: CollectionEntry[];
  moxfieldUpdatedAt: string | null;
  pricesUpdatedAt: number | null;
  view: ViewMode;
  sort: SortKey;
  migrationDone: boolean;
  legacyEntries: CollectionEntry[];
  importedOrderIds: string[];
}

export interface SavedBinder {
  version: 1;
  model: 2;
  manualEntries: CollectionEntry[];
  layerMoxfield: CollectionEntry[];
  layerTcgplayer: CollectionEntry[];
  layerPurchases: CollectionEntry[];
  moxfieldUpdatedAt: string | null;
  pricesUpdatedAt: number | null;
  view: ViewMode;
  sort: SortKey;
  migrationDone: true;
}

function entriesOf(value: unknown): CollectionEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => sanitizeEntry(entry)).filter((entry): entry is CollectionEntry => entry !== null);
}

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

const EMPTY: BinderState = {
  manualEntries: [],
  layerMoxfield: [],
  layerTcgplayer: [],
  layerPurchases: [],
  moxfieldUpdatedAt: null,
  pricesUpdatedAt: null,
  view: 'grid',
  sort: 'added-desc',
  migrationDone: true,
  legacyEntries: [],
  importedOrderIds: [],
};

export function loadBinder(): BinderState {
  const storage = browserStorage();
  if (!storage) return EMPTY;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return EMPTY;
    const data = JSON.parse(raw) as {
      model?: number;
      version?: number;
      entries?: unknown;
      manualEntries?: unknown;
      layerMoxfield?: unknown;
      layerTcgplayer?: unknown;
      layerPurchases?: unknown;
      moxfieldUpdatedAt?: unknown;
      pricesUpdatedAt?: unknown;
      view?: unknown;
      sort?: unknown;
      migrationDone?: unknown;
      importedOrderIds?: unknown;
    };
    if (!data || data.version !== 1) return EMPTY;
    const view: ViewMode = data.view === 'list' ? 'list' : 'grid';
    const sort = isSortKey(data.sort) ? data.sort : 'added-desc';
    const pricesUpdatedAt = typeof data.pricesUpdatedAt === 'number' ? data.pricesUpdatedAt : null;
    if (data.model === 2 && data.migrationDone === true) {
      return {
        manualEntries: entriesOf(data.manualEntries),
        layerMoxfield: entriesOf(data.layerMoxfield),
        layerTcgplayer: entriesOf(data.layerTcgplayer),
        layerPurchases: entriesOf(data.layerPurchases),
        moxfieldUpdatedAt: typeof data.moxfieldUpdatedAt === 'string' ? data.moxfieldUpdatedAt : null,
        pricesUpdatedAt,
        view,
        sort,
        migrationDone: true,
        legacyEntries: [],
        importedOrderIds: [],
      };
    }
    return {
      ...EMPTY,
      migrationDone: false,
      legacyEntries: entriesOf(data.entries),
      importedOrderIds: orderIds(data.importedOrderIds),
      pricesUpdatedAt,
      view,
      sort,
      manualEntries: [],
    };
  } catch {
    return EMPTY;
  }
}

export function saveBinder(data: SavedBinder): string | null {
  const storage = browserStorage();
  if (!storage) return 'This browser will not store the collection.';
  try {
    storage.setItem(KEY, JSON.stringify(data));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not save the collection on this device.';
  }
}
