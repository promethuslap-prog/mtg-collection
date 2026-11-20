import { availableFinishes, cardToEntry, type CardIdentifier, type ScryfallCard } from './cards';
import { oracleNames, tagLayer, withoutMoxfieldNames } from './layers';
import { parseMoxfieldFile, type MoxfieldCard, type MoxfieldFile } from './moxfield';
import { loadPurchaseFile, resolvePurchaseOrders } from './importPurchases';
import { fetchCollection } from './scryfall';
import { normalizeName } from './text';
import type { CollectionEntry, Finish } from './types';

export interface SyncedLayers {
  moxfield: CollectionEntry[];
  tcgplayer: CollectionEntry[];
  purchases: CollectionEntry[];
  updatedAt: string | null;
  moxfieldNames: string[];
}

export async function loadMoxfieldFile(): Promise<MoxfieldFile | null> {
  const url = `${import.meta.env.BASE_URL}moxfield.json?t=${Date.now()}`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    return parseMoxfieldFile(JSON.parse(text) as unknown);
  } catch (error) {
    console.warn('Moxfield file could not be read.', error);
    return null;
  }
}

export async function syncDerivedLayers(
  previous: { moxfield: CollectionEntry[]; purchases: CollectionEntry[] } = { moxfield: [], purchases: [] },
  signal?: AbortSignal,
): Promise<SyncedLayers | null> {
  const moxfieldFile = await loadMoxfieldFile();
  const purchaseFile = await loadPurchaseFile();
  if (!moxfieldFile && !purchaseFile) return null;
  let moxfield = previous.moxfield;
  if (moxfieldFile) {
    try {
      moxfield = await resolveMoxfieldCards(moxfieldFile.cards, signal, previous.moxfield);
    } catch (error) {
      console.warn(error);
      moxfield = projectMoxfield(moxfieldFile.cards, previous.moxfield);
    }
  }
  let purchases = previous.purchases;
  if (purchaseFile) {
    try {
      purchases = (await resolvePurchaseOrders(purchaseFile.orders, signal)).entries;
    } catch (error) {
      console.warn(error);
    }
  }
  const names = oracleNames(moxfield, moxfieldFile?.cards.map((card) => card.name) ?? []);
  return {
    moxfield,
    tcgplayer: withoutMoxfieldNames(purchases, names).map((entry) => tagLayer(entry, 'tcgplayer')),
    purchases,
    updatedAt: moxfieldFile?.updatedAt ?? null,
    moxfieldNames: [...names],
  };
}

function cacheKey(set: string, collectorNumber: string, finish: Finish): string {
  return `${set.toLowerCase()}|${collectorNumber.toLowerCase()}|${finish}`;
}

function requestedFinish(foil: MoxfieldCard['foil']): Finish {
  if (foil === 'etched') return 'etched';
  if (foil === 'foil') return 'foil';
  return 'nonfoil';
}

export function projectMoxfield(cards: MoxfieldCard[], previous: CollectionEntry[]): CollectionEntry[] {
  const previousByKey = new Map(previous.map((entry) => [cacheKey(entry.set, entry.collectorNumber, entry.finish), entry]));
  const projected: CollectionEntry[] = [];
  for (const card of cards) {
    const cached = previousByKey.get(cacheKey(card.set, card.collectorNumber, requestedFinish(card.foil)));
    if (!cached) continue;
    projected.push({
      ...cached,
      quantity: card.qty,
      ...(card.condition ? { condition: card.condition } : {}),
    });
  }
  return projected;
}

export async function resolveMoxfieldCards(cards: MoxfieldCard[], signal?: AbortSignal, previous: CollectionEntry[] = []): Promise<CollectionEntry[]> {
  const previousByKey = new Map(previous.map((entry) => [cacheKey(entry.set, entry.collectorNumber, entry.finish), entry]));
  const resolved = new Map<number, CollectionEntry>();
  const missing: MoxfieldCard[] = [];
  const missingIndex: number[] = [];
  cards.forEach((card, index) => {
    const cached = previousByKey.get(cacheKey(card.set, card.collectorNumber, requestedFinish(card.foil)));
    if (!cached) {
      missing.push(card);
      missingIndex.push(index);
      return;
    }
    resolved.set(index, {
      ...cached,
      quantity: card.qty,
      ...(card.condition ? { condition: card.condition } : {}),
    });
  });
  if (missing.length === 0) return cards.flatMap((_, index) => {
    const entry = resolved.get(index);
    return entry ? [entry] : [];
  });

  const fetched = new Map<number, ScryfallCard>();
  const byNumber = await lookup(missing.map((card) => ({ set: card.set, collector_number: card.collectorNumber })), signal);
  const missed: number[] = [];
  missing.forEach((card, missingAt) => {
    const index = missingIndex[missingAt];
    const found = byNumber.get(numberKey(card.set, card.collectorNumber));
    if (found) fetched.set(index, found);
    else missed.push(index);
  });

  if (missed.length > 0) {
    const byNameSet = await lookup(missed.map((index) => ({ name: cards[index].name, set: cards[index].set })), signal);
    const still: number[] = [];
    for (const index of missed) {
      const card = cards[index];
      const found = [...byNameSet.values()].find((candidate) => candidate.set.toLowerCase() === card.set && namesClose(candidate.name, card.name));
      if (found) fetched.set(index, found);
      else still.push(index);
    }
    if (still.length > 0) {
      const byName = await lookup(still.map((index) => ({ name: cards[index].name })), signal);
      for (const index of still) {
        const found = [...byName.values()].find((candidate) => namesClose(candidate.name, cards[index].name));
        if (found) fetched.set(index, found);
      }
    }
  }

  for (const [index, printing] of fetched) {
    const card = cards[index];
    const entry = cardToEntry(printing, chooseFinish(printing, card.foil), card.qty);
    resolved.set(index, tagLayer({
      ...entry,
      ...(card.condition ? { condition: card.condition } : {}),
    }, 'moxfield'));
  }

  return cards.flatMap((_, index) => {
    const entry = resolved.get(index);
    return entry ? [entry] : [];
  });
}

async function lookup(identifiers: CardIdentifier[], signal?: AbortSignal): Promise<Map<string, ScryfallCard>> {
  const unique: CardIdentifier[] = [];
  const seen = new Set<string>();
  for (const identifier of identifiers) {
    const key = JSON.stringify(identifier);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(identifier);
  }
  if (unique.length === 0) return new Map();
  const { cards } = await fetchCollection(unique, undefined, signal);
  const map = new Map<string, ScryfallCard>();
  for (const card of cards) {
    map.set(numberKey(card.set, card.collector_number), card);
    map.set(`${normalizeName(card.name)}|${card.set.toLowerCase()}`, card);
    map.set(normalizeName(card.name), card);
  }
  return map;
}

function numberKey(set: string, collectorNumber: string): string {
  return `${set.toLowerCase()}|${collectorNumber.toLowerCase()}`;
}

function namesClose(cardName: string, wanted: string): boolean {
  return normalizeName(cardName) === normalizeName(wanted) || normalizeName(cardName).startsWith(normalizeName(wanted));
}

function chooseFinish(card: ScryfallCard, foil: MoxfieldCard['foil']): Finish {
  const available = availableFinishes(card);
  if (foil === 'etched' && available.includes('etched')) return 'etched';
  if ((foil === 'etched' || foil === 'foil') && available.includes('foil')) return 'foil';
  if (foil === '' && available.includes('nonfoil')) return 'nonfoil';
  return available.includes('nonfoil') ? 'nonfoil' : available[0];
}
