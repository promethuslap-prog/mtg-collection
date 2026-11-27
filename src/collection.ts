import { normalizeName } from './text';
import type { CollectionEntry, Filters, SortKey } from './types';

export interface ColorBucket {
  key: string;
  label: string;
  count: number;
  value: number;
}

export interface SetBucket {
  set: string;
  setName: string;
  count: number;
  value: number;
}

export interface Summary {
  totalCards: number;
  uniqueCards: number;
  printings: number;
  value: number;
  missingPrices: number;
  colors: ColorBucket[];
  sets: SetBucket[];
}

export const TYPE_FILTERS: Array<{ id: string; label: string; words: string[] }> = [
  { id: 'Creature', label: 'Creature', words: ['Creature'] },
  { id: 'Instant', label: 'Instant', words: ['Instant'] },
  { id: 'Sorcery', label: 'Sorcery', words: ['Sorcery'] },
  { id: 'Enchantment', label: 'Enchantment', words: ['Enchantment'] },
  { id: 'Artifact', label: 'Artifact', words: ['Artifact'] },
  { id: 'Planeswalker', label: 'Planeswalker', words: ['Planeswalker'] },
  { id: 'Land', label: 'Land', words: ['Land'] },
  { id: 'Battle', label: 'Battle', words: ['Battle'] },
  { id: 'Kindred', label: 'Kindred', words: ['Kindred', 'Tribal'] },
];

export const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'added-desc', label: 'Recently added' },
  { id: 'added-asc', label: 'Oldest added' },
  { id: 'name-asc', label: 'Name (A–Z)' },
  { id: 'name-desc', label: 'Name (Z–A)' },
  { id: 'price-desc', label: 'Price (high–low)' },
  { id: 'price-asc', label: 'Price (low–high)' },
];

export const COLOR_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' },
  { id: 'M', label: 'Multicolor' },
  { id: 'C', label: 'Colorless' },
];

const COLOR_BUCKETS: Array<{ key: string; label: string; test: (identity: string[]) => boolean }> = [
  { key: 'W', label: 'White', test: (identity) => identity.length === 1 && identity[0] === 'W' },
  { key: 'U', label: 'Blue', test: (identity) => identity.length === 1 && identity[0] === 'U' },
  { key: 'B', label: 'Black', test: (identity) => identity.length === 1 && identity[0] === 'B' },
  { key: 'R', label: 'Red', test: (identity) => identity.length === 1 && identity[0] === 'R' },
  { key: 'G', label: 'Green', test: (identity) => identity.length === 1 && identity[0] === 'G' },
  { key: 'M', label: 'Multicolor', test: (identity) => identity.length > 1 },
  { key: 'C', label: 'Colorless', test: (identity) => identity.length === 0 },
];

export function isSortKey(value: unknown): value is SortKey {
  return SORTS.some((sort) => sort.id === value);
}

export function unitPrice(entry: CollectionEntry): number | null {
  if (entry.finish === 'foil') return entry.priceUsdFoil;
  if (entry.finish === 'etched') return entry.priceUsdEtched;
  return entry.priceUsd;
}

export function cardTypes(typeLine: string): Set<string> {
  const head = typeLine.split(/—|–|--/)[0] ?? '';
  const words = new Set(head.split(/[^A-Za-z]+/).filter(Boolean));
  const matched = new Set<string>();
  for (const type of TYPE_FILTERS) {
    if (type.words.some((word) => words.has(word))) matched.add(type.id);
  }
  return matched;
}

export function matchesColor(identity: string[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((color) => {
    if (color === 'M') return identity.length > 1;
    if (color === 'C') return identity.length === 0;
    return identity.includes(color);
  });
}

export function matchesFilters(entry: CollectionEntry, filters: Filters): boolean {
  if (filters.moxfield || filters.tcgplayer || filters.scanned) {
    const source = entry.source ?? (entry.fromTcgplayer ? 'tcgplayer' : 'manual');
    const selected = (filters.moxfield && source === 'moxfield') || (filters.tcgplayer && source === 'tcgplayer') || (filters.scanned && source === 'scanned');
    if (!selected) return false;
  }
  if (!matchesColor(entry.colorIdentity, filters.colors)) return false;
  if (filters.types.length > 0) {
    const types = cardTypes(entry.typeLine);
    if (!filters.types.some((type) => types.has(type))) return false;
  }
  if (filters.rarities.length > 0 && !filters.rarities.includes(entry.rarity)) return false;
  if (filters.set && entry.set !== filters.set) return false;
  const query = normalizeName(filters.query);
  if (!query) return true;
  const haystack = normalizeName(
    [entry.name, entry.typeLine, entry.setName, entry.set, entry.collectorNumber, entry.artist ?? ''].join(' '),
  );
  return haystack.includes(query);
}

export function canEditEntry(entry: CollectionEntry): boolean {
  return entry.source == null || entry.source === 'manual' || entry.source === 'scanned';
}

export function filterEntries(entries: CollectionEntry[], filters: Filters): CollectionEntry[] {
  return entries.filter((entry) => matchesFilters(entry, filters));
}

function compareNames(a: CollectionEntry, b: CollectionEntry): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.set.localeCompare(b.set);
}

export function sortEntries(entries: CollectionEntry[], sort: SortKey): CollectionEntry[] {
  const next = entries.slice();
  next.sort((a, b) => {
    switch (sort) {
      case 'name-asc':
        return compareNames(a, b);
      case 'name-desc':
        return compareNames(b, a);
      case 'added-asc':
        return a.addedAt - b.addedAt || compareNames(a, b);
      case 'added-desc':
        return b.addedAt - a.addedAt || compareNames(a, b);
      case 'price-asc':
      case 'price-desc': {
        const direction = sort === 'price-asc' ? 1 : -1;
        const priceA = unitPrice(a);
        const priceB = unitPrice(b);
        if (priceA == null && priceB == null) return compareNames(a, b);
        if (priceA == null) return 1;
        if (priceB == null) return -1;
        if (priceA !== priceB) return (priceA - priceB) * direction;
        return compareNames(a, b);
      }
      default:
        return 0;
    }
  });
  return next;
}

export function summarize(entries: CollectionEntry[]): Summary {
  const colors = COLOR_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, count: 0, value: 0 }));
  const sets = new Map<string, SetBucket>();
  const names = new Set<string>();
  let totalCards = 0;
  let value = 0;
  let missingPrices = 0;

  for (const entry of entries) {
    totalCards += entry.quantity;
    names.add(entry.oracleId || normalizeName(entry.name));
    const each = unitPrice(entry);
    const lineValue = each == null ? 0 : each * entry.quantity;
    if (each == null) missingPrices += entry.quantity;
    else value += lineValue;

    const bucket = colors.find((color) => COLOR_BUCKETS.find((item) => item.key === color.key)?.test(entry.colorIdentity));
    if (bucket) {
      bucket.count += entry.quantity;
      bucket.value += lineValue;
    }

    const current = sets.get(entry.set) ?? {
      set: entry.set,
      setName: entry.setName || entry.set.toUpperCase(),
      count: 0,
      value: 0,
    };
    current.count += entry.quantity;
    current.value += lineValue;
    if (!current.setName && entry.setName) current.setName = entry.setName;
    sets.set(entry.set, current);
  }

  return {
    totalCards,
    uniqueCards: names.size,
    printings: entries.length,
    value,
    missingPrices,
    colors: colors.filter((color) => color.count > 0),
    sets: [...sets.values()].sort((a, b) => b.count - a.count || a.setName.localeCompare(b.setName)),
  };
}

export function mergeIntoCollection(existing: CollectionEntry[], incoming: CollectionEntry[]): CollectionEntry[] {
  const map = new Map(existing.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const previous = map.get(entry.id);
    if (!previous) {
      map.set(entry.id, entry);
      continue;
    }
    map.set(entry.id, {
      ...previous,
      ...entry,
      quantity: Math.min(9999, previous.quantity + entry.quantity),
      addedAt: Math.min(previous.addedAt, entry.addedAt),
    });
  }
  return [...map.values()];
}

export function combineEntries(entries: CollectionEntry[]): CollectionEntry[] {
  return mergeIntoCollection([], entries);
}
