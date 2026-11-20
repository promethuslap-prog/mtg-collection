import { cardImages, type ScryfallCard } from './cards';
import { parseDecklist } from './decklist';
import { inferRoles, mergeRoles, type KnownCard, type RoleId } from './deckAnalyze';
import { parseDeckFile, type DeckCardLine, type DeckFile, type DeckRecord } from './deckModel';
import { fetchCollection, searchByQuery, searchOrdered } from './scryfall';
import { normalizeName } from './text';

const CARD_KEY = 'mtg-deck-card-cache.v1';
const TAG_KEY = 'mtg-deck-tag-cache.v1';
const PASTE_KEY = 'mtg-pasted-decks.v1';

export interface CachedPrinting {
  id: string;
  oracleId: string;
  name: string;
  set: string;
  setName: string;
  collectorNumber: string;
  manaCost: string;
  cmc: number;
  typeLine: string;
  colorIdentity: string[];
  oracleText: string;
  keywords: string[];
  legalityCommander: string;
  legalityStandard: string;
  edhrecRank: number | null;
  priceUsd: number | null;
  image: string;
  producedMana: string[];
}

const memoryCards = new Map<string, CachedPrinting>();
const memoryTags = new Map<string, RoleId[]>();

function readCache(): void {
  try {
    const cards = JSON.parse(localStorage.getItem(CARD_KEY) || '{}') as Record<string, CachedPrinting>;
    for (const [id, card] of Object.entries(cards)) memoryCards.set(id, card);
    const tags = JSON.parse(localStorage.getItem(TAG_KEY) || '{}') as Record<string, RoleId[]>;
    for (const [id, roles] of Object.entries(tags)) memoryTags.set(id, roles);
  } catch {
    /* ignore broken cache */
  }
}

function writeCache(): void {
  try {
    localStorage.setItem(CARD_KEY, JSON.stringify(Object.fromEntries(memoryCards)));
    localStorage.setItem(TAG_KEY, JSON.stringify(Object.fromEntries(memoryTags)));
  } catch {
    /* quota */
  }
}

let loaded = false;
function ensureCache(): void {
  if (loaded || typeof localStorage === 'undefined') return;
  loaded = true;
  readCache();
}

export function rememberPrinting(card: ScryfallCard): CachedPrinting {
  ensureCache();
  const printing: CachedPrinting = {
    id: card.id,
    oracleId: card.oracle_id ?? '',
    name: card.name,
    set: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    manaCost: card.mana_cost ?? '',
    cmc: card.cmc ?? 0,
    typeLine: card.type_line ?? '',
    colorIdentity: card.color_identity ?? [],
    oracleText: (card.oracle_text ?? '').slice(0, 500),
    keywords: card.keywords ?? [],
    legalityCommander: card.legalities?.commander ?? '',
    legalityStandard: card.legalities?.standard ?? '',
    edhrecRank: card.edhrec_rank ?? null,
    priceUsd: card.prices?.usd != null ? Number(card.prices.usd) : null,
    image: cardImages(card).front ?? '',
    producedMana: card.produced_mana ?? [],
  };
  memoryCards.set(card.id, printing);
  memoryCards.set(`${card.set}|${card.collector_number.toLowerCase()}`, printing);
  memoryCards.set(normalizeName(card.name), printing);
  return printing;
}

export async function loadDeckFile(): Promise<DeckFile | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}decks.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseDeckFile(await response.json());
  } catch (error) {
    console.warn(error);
    return null;
  }
}

export function loadPastedDecks(): DeckRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PASTE_KEY) || '[]') as DeckRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePastedDecks(decks: DeckRecord[]): void {
  localStorage.setItem(PASTE_KEY, JSON.stringify(decks));
}

export function pastedDeckFromText(name: string, format: DeckRecord['format'], commanders: string[], text: string): DeckRecord | null {
  const parsed = parseDecklist(text);
  if (parsed.error || parsed.lines.length === 0) return null;
  return {
    id: `pasted-${Date.now()}`,
    name: name.trim() || 'Pasted deck',
    format,
    commanders,
    url: '',
    pasted: true,
    mainboard: parsed.lines.map((line) => ({
      qty: line.quantity,
      name: line.name,
      set: line.set ?? '',
      collectorNumber: line.collectorNumber ?? '',
      foil: line.finish === 'nonfoil' ? '' : line.finish,
    })),
    sideboard: [],
  };
}

export async function resolveLines(lines: DeckCardLine[]): Promise<CachedPrinting[]> {
  ensureCache();
  const result: Array<CachedPrinting | undefined> = lines.map((line) => {
    if (line.set && line.collectorNumber) return memoryCards.get(`${line.set}|${line.collectorNumber.toLowerCase()}`);
    return memoryCards.get(normalizeName(line.name));
  });
  const missing = lines.filter((_, index) => !result[index]);
  if (missing.length) {
    const identifiers = missing.map((line) => line.set && line.collectorNumber
      ? { set: line.set, collector_number: line.collectorNumber }
      : { name: line.name });
    let cards: ScryfallCard[] = [];
    try {
      cards = (await fetchCollection(identifiers)).cards;
    } catch (error) {
      console.warn(error);
    }
    for (const card of cards) rememberPrinting(card);
    lines.forEach((line, index) => {
      if (result[index]) return;
      const found = line.set && line.collectorNumber
        ? memoryCards.get(`${line.set}|${line.collectorNumber.toLowerCase()}`)
        : memoryCards.get(normalizeName(line.name));
      if (found) result[index] = found;
    });
    const still = lines.map((line, index) => ({ line, index })).filter((item) => !result[item.index] && item.line.set);
    if (still.length) {
      let cards: ScryfallCard[] = [];
      try {
        cards = (await fetchCollection(still.map((item) => ({ name: item.line.name, set: item.line.set })))).cards;
      } catch (error) {
        console.warn(error);
      }
      for (const card of cards) rememberPrinting(card);
      for (const item of still) {
        const found = [...memoryCards.values()].find((card) => card.set === item.line.set && normalizeName(card.name) === normalizeName(item.line.name));
        if (found) result[item.index] = found;
      }
    }
    const names = lines.map((line, index) => ({ line, index })).filter((item) => !result[item.index]);
    if (names.length) {
      let cards: ScryfallCard[] = [];
      try {
        cards = (await fetchCollection(names.map((item) => ({ name: item.line.name })))).cards;
      } catch (error) {
        console.warn(error);
      }
      for (const card of cards) rememberPrinting(card);
      for (const item of names) {
        const found = memoryCards.get(normalizeName(item.line.name));
        if (found) result[item.index] = found;
      }
    }
    writeCache();
  }
  return result.filter((card): card is CachedPrinting => Boolean(card));
}

export async function resolveCommanders(names: string[]): Promise<CachedPrinting[]> {
  return resolveLines(names.map((name) => ({ qty: 1, name, set: '', collectorNumber: '', foil: '' })));
}

export function toKnown(
  line: DeckCardLine,
  printing: CachedPrinting | undefined,
  tags: RoleId[],
  format: 'commander' | 'standard',
): KnownCard | null {
  if (!printing) return null;
  const known = knownFromPrinting(printing, line.qty);
  known.roles = mergeRoles(known.roles, tags);
  known.legality = format === 'standard' ? printing.legalityStandard : printing.legalityCommander;
  return known;
}

export async function tagOracleIds(oracleIds: string[]): Promise<void> {
  ensureCache();
  const missing = [...new Set(oracleIds.filter((id) => id && !memoryTags.has(id)))];
  const queries: Array<[RoleId, string]> = [
    ['ramp', 'ramp'],
    ['draw', 'card-advantage'],
    ['removal', 'removal'],
    ['wipe', 'board-wipe'],
  ];
  for (const id of missing) if (!memoryTags.has(id)) memoryTags.set(id, []);
  for (const [role, tag] of queries) {
    for (let index = 0; index < missing.length; index += 12) {
      const chunk = missing.slice(index, index + 12);
      const query = `oracletag:${tag} (${chunk.map((id) => `oracleid:${id}`).join(' OR ')})`;
      const cards = await searchByQuery(query, undefined, 1);
      for (const card of cards) {
        if (!card.oracle_id) continue;
        const roles = memoryTags.get(card.oracle_id) ?? [];
        if (!roles.includes(role)) memoryTags.set(card.oracle_id, [...roles, role]);
      }
    }
  }
  writeCache();
}

export function tagsFor(oracleId: string): RoleId[] {
  ensureCache();
  return memoryTags.get(oracleId) ?? [];
}

export function printingById(id: string): CachedPrinting | undefined {
  ensureCache();
  return memoryCards.get(id);
}

export async function enrichCollection(ids: string[]): Promise<void> {
  ensureCache();
  const missing = ids.filter((id) => id && !memoryCards.has(id));
  if (!missing.length) return;
  try {
    const { cards } = await fetchCollection(missing.map((id) => ({ id })));
    for (const card of cards) rememberPrinting(card);
    writeCache();
  } catch (error) {
    console.warn(error);
  }
}

export async function upgradeSearch(identity: string[], format: 'commander' | 'standard'): Promise<CachedPrinting[]> {
  const colors = identity.join('').toLowerCase();
  const query = colors
    ? `id<=${colors} legal:${format} game:paper`
    : `legal:${format} game:paper`;
  const cards = await searchOrdered(query, 'edhrec');
  return cards.map((card) => rememberPrinting(card));
}

export function knownFromPrinting(printing: CachedPrinting, qty: number): KnownCard {
  return {
    name: printing.name,
    set: printing.set,
    collectorNumber: printing.collectorNumber,
    qty,
    cmc: printing.cmc,
    manaCost: printing.manaCost,
    typeLine: printing.typeLine,
    colorIdentity: printing.colorIdentity,
    oracleText: printing.oracleText,
    keywords: printing.keywords,
    legality: '',
    edhrecRank: printing.edhrecRank,
    priceUsd: printing.priceUsd,
    image: printing.image,
    producedMana: printing.producedMana,
    roles: mergeRoles(inferRoles(printing.typeLine, printing.oracleText), tagsFor(printing.oracleId)),
  };
}

export function knownFromCollection(
  entry: { scryfallId: string; quantity: number },
  format: 'commander' | 'standard',
): KnownCard | null {
  const printing = printingById(entry.scryfallId);
  if (!printing) return null;
  const known = knownFromPrinting(printing, entry.quantity);
  known.owned = true;
  known.legality = format === 'standard' ? printing.legalityStandard : printing.legalityCommander;
  return known;
}
