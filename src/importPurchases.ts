import { availableFinishes, cardNameList, cardToEntry, type CardIdentifier, type ScryfallCard } from './cards';
import { combineEntries } from './collection';
import {
  parsePurchase,
  parsePurchaseFile,
  pendingOrders,
  type ParsedPurchase,
  type PurchaseFile,
  type PurchaseOrder,
} from './purchases';
import { fetchCollection, fetchSets, searchByQuery } from './scryfall';
import { normalizeName } from './text';
import type { CollectionEntry, Finish } from './types';

export type MatchKind = 'exact' | 'name' | 'none';

export interface MatchDetail {
  orderId: string;
  name: string;
  set: string;
  kind: MatchKind;
  matchedSet: string | null;
  matchedName: string | null;
}

export interface PurchaseImport {
  entries: CollectionEntry[];
  skipped: string[];
  matchedOrderIds: string[];
  processedOrderIds: string[];
  addedCards: number;
  exactCount: number;
  nameCount: number;
  unmatchedCount: number;
  details: MatchDetail[];
}

export async function loadPurchaseFile(): Promise<PurchaseFile | null> {
  const url = `${import.meta.env.BASE_URL}purchases.json?t=${Date.now()}`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    return parsePurchaseFile(JSON.parse(text) as unknown);
  } catch (error) {
    console.warn('TCGplayer purchases file could not be read.', error);
    return null;
  }
}

export async function importNewOrders(importedIds: Iterable<string>, signal?: AbortSignal): Promise<PurchaseImport | null> {
  const file = await loadPurchaseFile();
  if (!file) return null;
  const pending = pendingOrders(file, importedIds);
  if (pending.length === 0) return null;
  const resolved = await resolvePurchaseOrders(pending, signal);
  return { ...resolved, processedOrderIds: pending.map((order) => order.id) };
}

export async function resolvePurchaseOrders(orders: PurchaseOrder[], signal?: AbortSignal): Promise<Omit<PurchaseImport, 'processedOrderIds'>> {
  const catalog = (await fetchSets(signal)).map((set) => ({ code: set.code, name: set.name, setType: set.set_type }));
  const parsed = orders.flatMap((order) => order.items.map((item) => parsePurchase(order.id, item, catalog)));
  const skipped: string[] = [];
  const details: MatchDetail[] = [];
  const hits: Array<{ item: ParsedPurchase; card: ScryfallCard; kind: 'exact' | 'name' }> = [];
  const pending = parsed.filter((item) => {
    if (!item.skipReason) return true;
    skipped.push(skipLabel(item));
    details.push(detail(item, 'none', null));
    return false;
  });

  const direct = pending.filter((item) => item.setCode && !item.variant && !item.playerInitials && !item.printingHint);
  const special = pending.filter((item) => !direct.includes(item));
  const found = await lookupDirect(direct, signal);
  const rest: ParsedPurchase[] = [];
  for (const item of direct) {
    const card = found.get(itemKey(item));
    if (card && namesMatch(card, item.name) && sameSet(card, item.setCode)) hits.push({ item, card, kind: 'exact' });
    else rest.push(item);
  }

  const needName: ParsedPurchase[] = [];
  for (const item of [...special, ...rest]) {
    if (signal?.aborted) break;
    const exact = await findExact(item, signal);
    if (exact) hits.push(exact);
    else needName.push(item);
  }

  const named = await lookupByName(needName, signal);
  for (const item of needName) {
    const card = named.get(itemKey(item));
    if (!card) {
      skipped.push(skipLabel(item));
      details.push(detail(item, 'none', null));
      continue;
    }
    const kind = sameSet(card, item.setCode) ? 'exact' : 'name';
    hits.push({ item, card, kind });
  }

  for (const hit of hits) details.push(detail(hit.item, hit.kind, hit.card));
  const entries = combineEntries(hits.map(({ item, card }) => toPurchaseEntry(item, card)));
  const matchedOrderIds = [...new Set(hits.map(({ item }) => item.orderId))];
  const addedCards = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  return {
    entries,
    skipped,
    matchedOrderIds,
    addedCards,
    exactCount: details.filter((line) => line.kind === 'exact').length,
    nameCount: details.filter((line) => line.kind === 'name').length,
    unmatchedCount: details.filter((line) => line.kind === 'none').length,
    details,
  };
}

function detail(item: ParsedPurchase, kind: MatchKind, card: ScryfallCard | null): MatchDetail {
  return {
    orderId: item.orderId,
    name: item.name,
    set: item.setLabel,
    kind,
    matchedSet: card ? card.set : null,
    matchedName: card ? card.name : null,
  };
}

function skipLabel(item: ParsedPurchase): string {
  const name = item.name || item.raw;
  return item.setLabel ? `${name} (${item.setLabel})` : name;
}

function itemKey(item: ParsedPurchase): string {
  return `${item.orderId}|${item.name}|${item.setCode ?? ''}|${item.collectorNumber ?? ''}|${item.foil}|${item.qty}|${item.raw}`;
}

async function lookupDirect(items: ParsedPurchase[], signal?: AbortSignal): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  if (items.length === 0) return result;
  const identifiers: CardIdentifier[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const identifier = identifierFor(item);
    const key = JSON.stringify(identifier);
    if (seen.has(key)) continue;
    seen.add(key);
    identifiers.push(identifier);
  }
  const { cards } = await fetchCollection(identifiers, undefined, signal);
  for (const item of items) {
    const card = cards.find((candidate) => cardMatches(candidate, item));
    if (card) result.set(itemKey(item), card);
  }
  return result;
}

function identifierFor(item: ParsedPurchase): CardIdentifier {
  if (item.setCode && item.collectorNumber) return { set: item.setCode, collector_number: item.collectorNumber };
  if (item.setCode) return { name: item.name, set: item.setCode };
  return { name: item.name };
}

function sameSet(card: ScryfallCard, setCode: string | null): boolean {
  return Boolean(setCode) && card.set.toLowerCase() === setCode;
}

function sameCollector(left: string, right: string): boolean {
  if (left.toLowerCase() === right.toLowerCase()) return true;
  return /^\d+$/.test(left) && /^\d+$/.test(right) && Number(left) === Number(right);
}

function cardMatches(card: ScryfallCard, item: ParsedPurchase): boolean {
  if (!namesMatch(card, item.name)) return false;
  if (item.setCode && !sameSet(card, item.setCode)) return false;
  if (item.collectorNumber && !sameCollector(card.collector_number, item.collectorNumber)) return false;
  return true;
}

function namesMatch(card: ScryfallCard, name: string): boolean {
  const target = normalizeName(name);
  return cardNameList(card).some((cardName) => normalizeName(cardName) === target);
}

function variantClause(variant: string | null): string {
  if (!variant) return '';
  const text = variant.toLowerCase();
  const parts: string[] = [];
  if (text.includes('retro')) parts.push('frame:1997');
  if (text.includes('future')) parts.push('frame:future');
  if (text.includes('borderless')) parts.push('border:borderless');
  if (text.includes('white border')) parts.push('border:white');
  if (text.includes('extended')) parts.push('is:extendedart');
  if (text.includes('showcase')) parts.push('is:showcase');
  if (text.includes('anime')) parts.push('is:anime');
  return parts.join(' ');
}

function variantSatisfied(item: ParsedPurchase, card: ScryfallCard): boolean {
  const clause = variantClause(item.variant);
  if (!clause) return true;
  const effects = card.frame_effects ?? [];
  if (clause.includes('frame:1997') && card.frame !== '1997') return false;
  if (clause.includes('frame:future') && card.frame !== 'future') return false;
  if (clause.includes('border:borderless') && card.border_color !== 'borderless') return false;
  if (clause.includes('border:white') && card.border_color !== 'white') return false;
  if (clause.includes('is:showcase') && !effects.includes('showcase')) return false;
  if (clause.includes('is:extendedart') && !effects.includes('extendedart')) return false;
  return true;
}

async function findExact(item: ParsedPurchase, signal?: AbortSignal): Promise<{ item: ParsedPurchase; card: ScryfallCard; kind: 'exact' } | null> {
  const clause = variantClause(item.variant);
  if (item.setCode && item.collectorNumber) {
    const { cards } = await fetchCollection([{ set: item.setCode, collector_number: item.collectorNumber }], undefined, signal);
    const card = cards.find((candidate) => cardMatches(candidate, item) && variantSatisfied(item, candidate));
    if (card) return { item, card, kind: 'exact' };
  }
  if (item.setCode && (clause || item.playerInitials || item.printingHint)) {
    const card = await searchBest(item, `set:${item.setCode} ${clause}`.trim(), signal);
    if (card && sameSet(card, item.setCode) && variantSatisfied(item, card)) return { item, card, kind: 'exact' };
  }
  if (item.setCode && !clause && !item.playerInitials) {
    const { cards } = await fetchCollection([{ name: item.name, set: item.setCode }], undefined, signal);
    const card = cards.find((candidate) => namesMatch(candidate, item.name) && sameSet(candidate, item.setCode));
    if (card) return { item, card, kind: 'exact' };
  }
  if (!item.setCode && clause) {
    const card = await searchBest(item, clause, signal);
    if (card && variantSatisfied(item, card)) return { item, card, kind: 'exact' };
  }
  return null;
}

async function lookupByName(items: ParsedPurchase[], signal?: AbortSignal): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  if (items.length === 0) return result;
  const identifiers: CardIdentifier[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    identifiers.push({ name: item.name });
  }
  const { cards } = await fetchCollection(identifiers, undefined, signal);
  for (const item of items) {
    const card = cards.find((candidate) => namesMatch(candidate, item.name));
    if (card) result.set(itemKey(item), card);
  }
  return result;
}

async function searchBest(item: ParsedPurchase, extra: string, signal?: AbortSignal): Promise<ScryfallCard | null> {
  const escaped = item.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const query = `!"${escaped}" unique:prints lang:en ${extra}`.trim();
  const cards = (await searchByQuery(query, signal, 2))
    .filter((card) => namesMatch(card, item.name) && variantSatisfied(item, card))
    .sort((a, b) => printingRank(a) - printingRank(b));
  if (cards.length === 0) return null;
  if (item.collectorNumber) {
    const numbered = cards.find((card) => sameCollector(card.collector_number, item.collectorNumber ?? ''));
    if (numbered) return numbered;
  }
  if (item.playerInitials) {
    const playerCard = cards.find((card) => card.collector_number.toLowerCase().startsWith(item.playerInitials ?? ''));
    if (playerCard) return playerCard;
  }
  if (item.printingHint) {
    const hinted = cards.find((card) => card.collector_number.toLowerCase().startsWith(`${item.printingHint}-`));
    if (hinted) return hinted;
  }
  if (item.variant?.toLowerCase().includes('bundle')) {
    const bundle = cards.find((card) => card.promo_types?.includes('bundle'));
    if (bundle) return bundle;
  }
  if (item.setCode) {
    const inSet = cards.find((card) => sameSet(card, item.setCode));
    if (inSet) return inSet;
  }
  return cards[0];
}

function printingRank(card: ScryfallCard): number {
  let rank = 0;
  if (card.promo_types?.includes('serialized')) rank += 50;
  if (/z$/i.test(card.collector_number)) rank += 40;
  if (card.promo_types?.includes('doublerainbow')) rank += 20;
  return rank;
}

function chooseFinish(card: ScryfallCard, item: ParsedPurchase): Finish {
  const available = availableFinishes(card);
  if (item.etched && available.includes('etched')) return 'etched';
  if (item.foil && available.includes('foil')) return 'foil';
  if (!item.foil && !item.etched && available.includes('nonfoil')) return 'nonfoil';
  return available.includes('nonfoil') ? 'nonfoil' : available[0];
}

function toPurchaseEntry(item: ParsedPurchase, card: ScryfallCard): CollectionEntry {
  const entry = cardToEntry(card, chooseFinish(card, item), item.qty);
  return {
    ...entry,
    fromTcgplayer: true,
    ...(item.condition ? { condition: item.condition } : {}),
  };
}
