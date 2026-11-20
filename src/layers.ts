import { applyQuantityUndo } from './purchases';
import { normalizeName } from './text';
import type { CollectionEntry } from './types';

export function legacyEntryId(entry: CollectionEntry): string {
  return `${entry.scryfallId}:${entry.finish}`;
}

export function manualEntriesAfterImport(stored: CollectionEntry[], imported: CollectionEntry[]): CollectionEntry[] {
  const deltas = imported.map((entry) => ({ id: legacyEntryId(entry), added: entry.quantity }));
  return applyQuantityUndo(stored, deltas).map((entry) => {
    const next = { ...entry, id: legacyEntryId(entry), source: 'manual' as const };
    delete next.fromTcgplayer;
    return next;
  });
}

export function oracleNames(entries: CollectionEntry[], extraNames: string[] = []): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) names.add(normalizeName(entry.name));
  for (const name of extraNames) names.add(normalizeName(name));
  return names;
}

export function withoutMoxfieldNames(entries: CollectionEntry[], names: Set<string>): CollectionEntry[] {
  return entries.filter((entry) => !names.has(normalizeName(entry.name)));
}

export function quantityDelta(previous: CollectionEntry[], next: CollectionEntry[]): number {
  const sum = (list: CollectionEntry[]) => list.reduce((total, entry) => total + entry.quantity, 0);
  return sum(next) - sum(previous);
}

export function layerChangeNote(
  previousMoxfield: CollectionEntry[],
  nextMoxfield: CollectionEntry[],
  previousTcgplayer: CollectionEntry[],
  nextTcgplayer: CollectionEntry[],
): string | null {
  const parts: string[] = [];
  const moxfield = quantityDelta(previousMoxfield, nextMoxfield);
  const tcgplayer = quantityDelta(previousTcgplayer, nextTcgplayer);
  if (moxfield !== 0) parts.push(`${signed(moxfield)} from Moxfield`);
  if (tcgplayer !== 0) parts.push(`${signed(tcgplayer)} from TCGplayer`);
  return parts.length > 0 ? parts.join(', ') : null;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function tagLayer(entry: CollectionEntry, source: 'moxfield' | 'tcgplayer'): CollectionEntry {
  const base = legacyEntryId(entry);
  return {
    ...entry,
    id: `${source}:${base}`,
    source,
    fromTcgplayer: source === 'tcgplayer',
  };
}
