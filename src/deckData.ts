import { cardImages, type ScryfallCard } from './cards';
import { parseDecklist } from './decklist';
import { inferRoles, mergeRoles, type KnownCard, type RoleId } from './deckAnalyze';
import { formatSpec, parseDeckFile, type DeckCardLine, type DeckFile, type DeckFormat, type DeckRecord } from './deckModel';
import { autocomplete, fetchCollection, searchByQuery, searchOrdered } from './scryfall';
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
  legalities: Record<string, string>;
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
    legalities: card.legalities ?? {},
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

export function legalityFor(printing: CachedPrinting, format: DeckFormat): string {
  const key = formatSpec(format).legality;
  if (!key) return 'legal';
  if (printing.legalities?.[key]) return printing.legalities[key];
  if (key === 'commander' && printing.legalityCommander) return printing.legalityCommander;
  if (key === 'standard' && printing.legalityStandard) return printing.legalityStandard;
  return '';
}

export function pastedDeckFromText(name: string, format: DeckRecord['format'], commanders: string[], text: string): DeckRecord | null {
  const parsed = parseDecklist(text);
  if (parsed.error || parsed.lines.length === 0) return null;
  return {
    id: `pasted-${Date.now()}`,
    name: name.trim() || 'Pasted deck',
    format,
    url: '',
    pasted: true,
    origin: 'local',
    mainboard: parsed.lines.filter((line) => line.section === 'mainboard').map(lineFromParsed),
    sideboard: parsed.lines.filter((line) => line.section === 'sideboard').map(lineFromParsed),
    maybeboard: parsed.lines.filter((line) => line.section === 'maybeboard').map(lineFromParsed),
    commanderBoard: parsed.lines.filter((line) => line.section === 'commander').map(lineFromParsed),
    commanders: commanders.length > 0
      ? commanders
      : parsed.lines.filter((line) => line.section === 'commander').map((line) => line.name),
  };
}

function lineFromParsed(line: { quantity: number; name: string; set?: string; collectorNumber?: string; finish: string }): DeckCardLine {
  return {
    qty: line.quantity,
    name: line.name,
    set: line.set ?? '',
    collectorNumber: line.collectorNumber ?? '',
    foil: line.finish === 'foil' || line.finish === 'etched' ? line.finish : '',
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
  format: DeckFormat,
): KnownCard | null {
  if (!printing) return null;
  const known = knownFromPrinting(printing, line.qty);
  known.roles = mergeRoles(known.roles, tags);
  known.legality = legalityFor(printing, format);
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
  const missing = ids.filter((id) => {
    if (!id) return false;
    const cached = memoryCards.get(id);
    return !cached || !cached.legalities || Object.keys(cached.legalities).length === 0;
  });
  if (!missing.length) return;
  try {
    const { cards } = await fetchCollection(missing.map((id) => ({ id })));
    for (const card of cards) rememberPrinting(card);
    writeCache();
  } catch (error) {
    console.warn(error);
  }
}

export function deckCardQuery(text: string, format: DeckFormat, identity: string[], restrict: boolean): string {
  const raw = text.trim();
  if (!restrict) return raw;
  const spec = formatSpec(format);
  const parts = [raw];
  if (spec.legality) parts.push(`legal:${spec.legality}`);
  if (spec.commander && identity.length > 0) parts.push(`id<=${identity.join('').toLowerCase()}`);
  if (!/game:/.test(raw)) parts.push('game:paper');
  return parts.filter(Boolean).join(' ');
}

export async function upgradeSearch(identity: string[], format: DeckFormat): Promise<CachedPrinting[]> {
  const query = deckCardQuery('', format, identity, true) || 'game:paper';
  const cards = await searchOrdered(query, 'edhrec');
  return cards.map((card) => rememberPrinting(card));
}

function escapeExact(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function findCommanders(
  query: string,
  format: DeckFormat,
  kind: 'commander' | 'partner' | 'background',
  signal?: AbortSignal,
): Promise<CachedPrinting[]> {
  const names = await autocomplete(query, signal);
  if (names.length === 0) return [];
  const spec = formatSpec(format);
  const legal = spec.legality || 'commander';
  const clause = names.slice(0, 10).map((name) => `!"${escapeExact(name)}"`).join(' OR ');
  const kindQuery = kind === 'background'
    ? 't:background'
    : kind === 'partner'
      ? 'is:commander (keyword:partner OR keyword:"friends forever" OR o:"partner with")'
      : 'is:commander';
  const cards = await searchOrdered(`(${clause}) ${kindQuery} legal:${legal}`, 'name', signal);
  return cards.map((card) => rememberPrinting(card));
}

export async function findLegalNames(
  query: string,
  format: DeckFormat,
  identity: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const names = await autocomplete(query, signal);
  if (names.length === 0) return [];
  try {
    const clause = names.slice(0, 12).map((name) => `!"${escapeExact(name)}"`).join(' OR ');
    const cards = await searchOrdered(deckCardQuery(`(${clause})`, format, identity, true), 'name', signal);
    const allowed = new Set(cards.map((card) => card.name));
    return names.filter((name) => allowed.has(name));
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return names;
  }
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
  format: DeckFormat,
): KnownCard | null {
  const printing = printingById(entry.scryfallId);
  if (!printing) return null;
  const known = knownFromPrinting(printing, entry.quantity);
  known.owned = true;
  known.legality = legalityFor(printing, format);
  return known;
}
