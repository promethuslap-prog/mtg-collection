import type { DeckSection } from './decklist';
import { pastedDeckFromText } from './deckData';
import { loadPastedDecks } from './deckData';
import {
  isDeckFormat,
  isLocalDeck,
  linesOf,
  type DeckCardLine,
  type DeckFormat,
  type DeckRecord,
  type DeckSectionName,
} from './deckModel';
import { normalizeName } from './text';

const KEY = 'mtg-user-decks.v1';
const MIGRATED = 'mtg-pasted-decks-migrated.v1';
const IDB_NAME = 'mtg-collection';
const IDB_STORE = 'kv';
const IDB_KEY = 'user-decks';

export interface DeckBackup {
  version: 1;
  kind: 'mtg-user-decks';
  exportedAt: string;
  decks: DeckRecord[];
}

export function createDeckId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function foilMark(foil: DeckCardLine['foil']): '' | 'foil' | 'etched' {
  if (foil === 'etched') return 'etched';
  if (foil === 'foil' || foil === true) return 'foil';
  return '';
}

export function lineKey(line: DeckCardLine): string {
  return [normalizeName(line.name), line.set.toLowerCase(), line.collectorNumber.toLowerCase(), foilMark(line.foil)].join('|');
}

export function createUserDeck(name: string, format: DeckFormat, commanderBoard: DeckCardLine[] = []): DeckRecord {
  return {
    id: createDeckId(),
    name: name.trim() || 'New deck',
    format,
    commanders: uniqueNames(commanderBoard),
    url: '',
    mainboard: [],
    sideboard: [],
    maybeboard: [],
    commanderBoard,
    origin: 'local',
  };
}

export function userDeckFromText(name: string, format: DeckFormat, commanders: string[], text: string): DeckRecord | null {
  const deck = pastedDeckFromText(name, format, commanders, text);
  if (!deck) return null;
  const commanderBoard = deck.commanderBoard ?? [];
  if (commanderBoard.length === 0 && commanders.length > 0) {
    deck.commanderBoard = commanders.map((commander) => ({ qty: 1, name: commander, set: '', collectorNumber: '', foil: '' }));
  }
  deck.commanders = uniqueNames(deck.commanderBoard ?? []);
  if (deck.commanders.length === 0) deck.commanders = commanders;
  deck.origin = 'local';
  deck.id = createDeckId();
  return deck;
}

export function duplicateDeck(source: DeckRecord): DeckRecord {
  const commanderNames = new Set(source.commanders.map((name) => normalizeName(name)));
  let commanderBoard = [...(source.commanderBoard ?? [])];
  let mainboard = source.mainboard.map((line) => ({ ...line }));
  if (commanderBoard.length === 0 && commanderNames.size > 0) {
    commanderBoard = mainboard.filter((line) => commanderNames.has(normalizeName(line.name))).map((line) => ({ ...line, qty: 1 }));
    mainboard = mainboard.filter((line) => !commanderNames.has(normalizeName(line.name)));
  }
  return {
    id: createDeckId(),
    name: `${source.name} copy`,
    format: source.format,
    commanders: commanderBoard.length > 0 ? uniqueNames(commanderBoard) : [...source.commanders],
    url: '',
    mainboard,
    sideboard: source.sideboard.map((line) => ({ ...line })),
    maybeboard: (source.maybeboard ?? []).map((line) => ({ ...line })),
    commanderBoard,
    origin: 'local',
    ...(source.ignoreLegality ? { ignoreLegality: true } : {}),
    ...(source.includeUncards ? { includeUncards: true } : {}),
    ...(source.strategy ? { strategy: source.strategy } : {}),
  };
}

export function withSection(deck: DeckRecord, section: DeckSectionName, lines: DeckCardLine[]): DeckRecord {
  const next: DeckRecord = { ...deck, origin: 'local' };
  if (section === 'commander') {
    next.commanderBoard = lines;
    next.commanders = uniqueNames(lines);
  } else if (section === 'sideboard') next.sideboard = lines;
  else if (section === 'maybeboard') next.maybeboard = lines;
  else next.mainboard = lines;
  return next;
}

export function upsertLine(lines: DeckCardLine[], line: DeckCardLine): DeckCardLine[] {
  const key = lineKey(line);
  const index = lines.findIndex((item) => lineKey(item) === key);
  if (index < 0) return [...lines, { ...line, qty: clampQty(line.qty), foil: foilMark(line.foil) }];
  const next = lines.slice();
  next[index] = { ...next[index], qty: clampQty(next[index].qty + line.qty) };
  return next;
}

export function toMoxfieldText(deck: DeckRecord): string {
  const blocks: string[] = [];
  const write = (title: string, lines: DeckCardLine[]) => {
    if (lines.length === 0) return;
    blocks.push(title);
    for (const line of lines) {
      const set = line.set ? ` (${line.set.toUpperCase()})` : '';
      const number = line.collectorNumber ? ` ${line.collectorNumber}` : '';
      const finish = foilMark(line.foil) === 'etched' ? ' *E*' : foilMark(line.foil) === 'foil' ? ' *F*' : '';
      blocks.push(`${line.qty} ${line.name}${set}${number}${finish}`);
    }
    blocks.push('');
  };
  const commanders = linesOf(deck, 'commander');
  write('Commander', commanders);
  write('Deck', deck.mainboard);
  write('Sideboard', deck.sideboard);
  write('Maybeboard', linesOf(deck, 'maybeboard'));
  return `${blocks.join('\n').trim()}\n`;
}

export function serializeUserDecks(decks: DeckRecord[]): string {
  const file: DeckBackup = {
    version: 1,
    kind: 'mtg-user-decks',
    exportedAt: new Date().toISOString(),
    decks: decks.filter(isLocalDeck).map((deck) => normalizeDeck(deck)).filter((deck): deck is DeckRecord => deck !== null),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseUserDeckBackup(text: string): { decks: DeckRecord[]; error: string | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { decks: [], error: 'That file is not JSON.' };
  }
  if (!data || typeof data !== 'object') return { decks: [], error: 'That file is not a deck backup.' };
  const file = data as { kind?: unknown; decks?: unknown };
  if (file.kind !== 'mtg-user-decks' || !Array.isArray(file.decks)) {
    return { decks: [], error: 'Choose a deck backup file from this site.' };
  }
  const decks = file.decks.map(normalizeDeck).filter((deck): deck is DeckRecord => deck !== null);
  if (decks.length === 0) return { decks: [], error: 'No decks found in that file.' };
  return { decks, error: null };
}

export function loadUserDecks(): DeckRecord[] {
  const storage = browserStorage();
  const stored = readStored(storage);
  if (!storage) return stored;
  if (storage.getItem(MIGRATED) === '1') return stored;
  const pasted = loadPastedDecks().map((deck) => normalizeDeck({ ...deck, origin: 'local', pasted: true })).filter((deck): deck is DeckRecord => deck !== null);
  const ids = new Set(stored.map((deck) => deck.id));
  const merged = [...stored, ...pasted.filter((deck) => !ids.has(deck.id))];
  try {
    storage.setItem(KEY, JSON.stringify(merged));
    storage.setItem(MIGRATED, '1');
  } catch {
    /* keep the merged list in memory even if it cannot be stored yet */
  }
  return merged;
}

export async function loadUserDecksFromIdb(): Promise<DeckRecord[] | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const json = await idbGet();
    if (!json) return null;
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(normalizeDeck).filter((deck): deck is DeckRecord => deck !== null) : null;
  } catch {
    return null;
  }
}

export async function saveUserDecks(decks: DeckRecord[]): Promise<string | null> {
  const json = JSON.stringify(decks.map(normalizeDeck).filter((deck): deck is DeckRecord => deck !== null));
  const storage = browserStorage();
  if (storage) {
    try {
      storage.setItem(KEY, json);
      return null;
    } catch {
      /* fall through to IndexedDB when localStorage is full */
    }
  }
  if (typeof indexedDB === 'undefined') return 'This browser will not store decks.';
  try {
    await idbSet(json);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not save decks on this device.';
  }
}

export function commanderCompanion(keywords: string[], oracleText: string): { kind: 'partner' | 'background' | 'named'; name: string } | null {
  const named = keywords.find((keyword) => /^partner with /i.test(keyword));
  if (named) return { kind: 'named', name: named.replace(/^partner with /i, '').trim() };
  const lowered = keywords.map((keyword) => keyword.toLowerCase());
  if (lowered.includes('partner') || lowered.includes('friends forever') || lowered.includes("doctor's companion")) {
    return { kind: 'partner', name: '' };
  }
  if (lowered.some((keyword) => keyword.includes('background')) || /choose a background/i.test(oracleText)) {
    return { kind: 'background', name: '' };
  }
  return null;
}

export function sectionLabel(section: DeckSection | DeckSectionName): string {
  if (section === 'commander') return 'Commander';
  if (section === 'sideboard') return 'Sideboard';
  if (section === 'maybeboard') return 'Maybeboard';
  return 'Mainboard';
}

function uniqueNames(lines: DeckCardLine[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    if (!names.some((name) => normalizeName(name) === normalizeName(line.name))) names.push(line.name);
  }
  return names;
}

function clampQty(qty: number): number {
  return Math.min(99, Math.max(1, Math.floor(qty) || 1));
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readStored(storage: Storage | null): DeckRecord[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeDeck).filter((deck): deck is DeckRecord => deck !== null);
  } catch {
    return [];
  }
}

function normalizeDeck(value: unknown): DeckRecord | null {
  if (!value || typeof value !== 'object') return null;
  const deck = value as Partial<DeckRecord>;
  if (typeof deck.id !== 'string' || typeof deck.name !== 'string') return null;
  if (!isDeckFormat(deck.format)) return null;
  const commanderBoard = parseLines(deck.commanderBoard);
  const commanders = Array.isArray(deck.commanders)
    ? deck.commanders.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map((name) => name.trim())
    : uniqueNames(commanderBoard);
  return {
    id: deck.id,
    name: deck.name.trim() || 'Untitled deck',
    format: deck.format,
    commanders: commanders.length > 0 ? commanders : uniqueNames(commanderBoard),
    url: '',
    mainboard: parseLines(deck.mainboard),
    sideboard: parseLines(deck.sideboard),
    maybeboard: parseLines(deck.maybeboard),
    commanderBoard,
    origin: 'local',
    ...(deck.ignoreLegality ? { ignoreLegality: true } : {}),
    ...(deck.includeUncards ? { includeUncards: true } : {}),
    ...(readStrategy(deck.strategy) ? { strategy: readStrategy(deck.strategy) } : {}),
  };
}

function readStrategy(value: unknown): DeckRecord['strategy'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const strategy = value as Partial<NonNullable<DeckRecord['strategy']>>;
  if (typeof strategy.archetype !== 'string' || typeof strategy.overview !== 'string') return undefined;
  const list = (item: unknown) => Array.isArray(item) ? item.filter((line): line is string => typeof line === 'string') : [];
  return {
    archetype: strategy.archetype,
    overview: strategy.overview,
    early: typeof strategy.early === 'string' ? strategy.early : '',
    mid: typeof strategy.mid === 'string' ? strategy.mid : '',
    late: typeof strategy.late === 'string' ? strategy.late : '',
    synergies: list(strategy.synergies),
    wins: list(strategy.wins),
    mulligan: typeof strategy.mulligan === 'string' ? strategy.mulligan : '',
    strengths: typeof strategy.strengths === 'string' ? strategy.strengths : '',
    weaknesses: typeof strategy.weaknesses === 'string' ? strategy.weaknesses : '',
    playAround: typeof strategy.playAround === 'string' ? strategy.playAround : '',
    bracketNote: typeof strategy.bracketNote === 'string' ? strategy.bracketNote : '',
    ...(typeof strategy.notes === 'string' && strategy.notes.trim() ? { notes: strategy.notes } : {}),
  };
}

function parseLines(value: unknown): DeckCardLine[] {
  if (!Array.isArray(value)) return [];
  const lines: DeckCardLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const line = item as Partial<DeckCardLine>;
    if (typeof line.name !== 'string' || !line.name.trim()) continue;
    const qty = Math.floor(Number(line.qty ?? 1));
    lines.push({
      qty: Number.isFinite(qty) && qty > 0 ? Math.min(99, qty) : 1,
      name: line.name.trim(),
      set: typeof line.set === 'string' ? line.set.toLowerCase() : '',
      collectorNumber: typeof line.collectorNumber === 'string' ? line.collectorNumber : '',
      foil: foilMark(line.foil ?? ''),
    });
  }
  return lines;
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open deck storage.'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbSet(json: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(json, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save decks.'));
  });
  db.close();
}

async function idbGet(): Promise<string | null> {
  const db = await idbOpen();
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('Could not read decks.'));
  });
  db.close();
  return value;
}
