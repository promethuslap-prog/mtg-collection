import type { CollectionEntry, Finish } from './types';

export interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
}

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  lang?: string;
  layout?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: Array<{
    name?: string;
    image_uris?: ScryfallImageUris;
    artist?: string;
    type_line?: string;
  }>;
  type_line?: string;
  color_identity?: string[];
  set: string;
  set_name: string;
  collector_number: string;
  rarity?: string;
  finishes?: string[];
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
  };
  scryfall_uri?: string;
  artist?: string;
  games?: string[];
}

export interface CardIdentifier {
  id?: string;
  name?: string;
  set?: string;
  collector_number?: string;
}

const COLOR_LETTERS = new Set(['W', 'U', 'B', 'R', 'G']);

export function entryKey(scryfallId: string, finish: Finish): string {
  return `${scryfallId}:${finish}`;
}

export function safeImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    const host = parsed.hostname;
    if (host !== 'scryfall.io' && !host.endsWith('.scryfall.io')) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function safeScryfallUri(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    if (parsed.hostname !== 'scryfall.com' && parsed.hostname !== 'www.scryfall.com') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function parseMoney(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function cardImages(card: ScryfallCard): { front?: string; back?: string } {
  const front = safeImage(card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal);
  const back = safeImage(card.card_faces?.[1]?.image_uris?.normal);
  return { front, back };
}

export function availableFinishes(card: ScryfallCard): Finish[] {
  const finishes = card.finishes ?? [];
  const available: Finish[] = [];
  if (finishes.includes('nonfoil')) available.push('nonfoil');
  if (finishes.includes('foil')) available.push('foil');
  if (finishes.includes('etched')) available.push('etched');
  return available.length > 0 ? available : ['nonfoil'];
}

export function priceForFinish(card: ScryfallCard, finish: Finish): number | null {
  if (finish === 'foil') return parseMoney(card.prices?.usd_foil);
  if (finish === 'etched') return parseMoney(card.prices?.usd_etched);
  return parseMoney(card.prices?.usd);
}

function colorIdentity(card: ScryfallCard): string[] {
  const source = card.color_identity ?? [];
  const unique: string[] = [];
  for (const color of source) {
    const letter = color.toUpperCase();
    if (COLOR_LETTERS.has(letter) && !unique.includes(letter)) unique.push(letter);
  }
  return unique;
}

function typeLine(card: ScryfallCard): string {
  if (card.type_line) return card.type_line;
  const faces = (card.card_faces ?? []).map((face) => face.type_line).filter((line): line is string => Boolean(line));
  return faces.join(' // ') || 'Card';
}

export function cardToEntry(
  card: ScryfallCard,
  finish: Finish,
  quantity: number,
  addedAt = Date.now(),
): CollectionEntry {
  const images = cardImages(card);
  const scryfallId = card.id;
  return {
    id: entryKey(scryfallId, finish),
    scryfallId,
    oracleId: card.oracle_id ?? '',
    name: card.name,
    set: (card.set ?? '').toLowerCase(),
    setName: card.set_name ?? '',
    collectorNumber: card.collector_number ?? '',
    rarity: card.rarity ?? 'unknown',
    colorIdentity: colorIdentity(card),
    typeLine: typeLine(card),
    image: images.front ?? '',
    imageBack: images.back,
    priceUsd: parseMoney(card.prices?.usd),
    priceUsdFoil: parseMoney(card.prices?.usd_foil),
    priceUsdEtched: parseMoney(card.prices?.usd_etched),
    finish,
    quantity: Math.min(9999, Math.max(1, Math.floor(quantity))),
    addedAt,
    scryfallUri: safeScryfallUri(card.scryfall_uri) ?? '',
    artist: card.artist ?? card.card_faces?.[0]?.artist,
  };
}

export function updateEntryFromCard(entry: CollectionEntry, card: ScryfallCard): CollectionEntry {
  const fresh = cardToEntry(card, entry.finish, entry.quantity, entry.addedAt);
  return {
    ...fresh,
    id: entry.id,
    image: fresh.image || entry.image,
    imageBack: fresh.imageBack ?? entry.imageBack,
    addedAt: entry.addedAt,
    quantity: entry.quantity,
  };
}

export function cardNameList(card: ScryfallCard): string[] {
  const names = [card.name];
  for (const face of card.card_faces ?? []) {
    if (face.name) names.push(face.name);
  }
  return names;
}
