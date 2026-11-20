import { searchOrdered } from './scryfall';
import { normalizeName } from './text';

export type BracketId = 1 | 2 | 3 | 4 | 5 | 'any';

export const BRACKETS: Array<{ id: BracketId; label: string; blurb: string }> = [
  { id: 1, label: '1 Exhibition', blurb: 'Theme over power. No Game Changers, mass land denial, extra turns, or two-card combos.' },
  { id: 2, label: '2 Core', blurb: 'Straightforward decks. No Game Changers, mass land denial, or two-card combos. At most one extra-turn card.' },
  { id: 3, label: '3 Upgraded', blurb: 'Stronger cards and up to three Game Changers. No mass land denial, chained extra turns, or two-card combos.' },
  { id: 4, label: '4 Optimized', blurb: 'High power. No bracket restrictions beyond the Commander banned list.' },
  { id: 5, label: '5 cEDH', blurb: 'Fast mana, tutors, compact combos, and a low curve, aimed at winning.' },
  { id: 'any', label: 'Any / no limit', blurb: 'Ignore bracket limits and build the strongest legal deck.' },
];

export interface CardSignals {
  gameChanger: boolean;
  massLandDenial: boolean;
  extraTurn: boolean;
  tutor: boolean;
  fastMana: boolean;
}

export interface BracketReview {
  estimated: Exclude<BracketId, 'any'>;
  label: string;
  gameChangers: string[];
  massLandDenial: string[];
  extraTurns: string[];
  tutors: string[];
  combos: Array<{ a: string; b: string }>;
  fastMana: string[];
  notes: string[];
}

export interface SkipNote {
  name: string;
  reason: string;
}

interface Limits {
  maxGameChangers: number;
  maxExtraTurns: number;
  maxFastMana: number;
  allowMassLandDenial: boolean;
  allowCombos: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_KEY = 'deck-gamechangers';

const COMBO_PAIRS: Array<[string, string]> = [
  ["Thassa's Oracle", 'Demonic Consultation'],
  ["Thassa's Oracle", 'Tainted Pact'],
  ['Dramatic Reversal', 'Isochron Scepter'],
  ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'],
  ['Kiki-Jiki, Mirror Breaker', 'Combat Celebrant'],
  ['Kiki-Jiki, Mirror Breaker', 'Felidar Guardian'],
  ['Kiki-Jiki, Mirror Breaker', 'Village Bell-Ringer'],
  ['Splinter Twin', 'Deceiver Exarch'],
  ['Splinter Twin', 'Pestermite'],
  ['Splinter Twin', 'Village Bell-Ringer'],
  ['Helm of the Host', 'Godo, Bandit Warlord'],
  ['Sanguine Bond', 'Exquisite Blood'],
  ['Mikaeus, the Unhallowed', 'Triskelion'],
  ['Mikaeus, the Unhallowed', 'Walking Ballista'],
  ['Heliod, Sun-Crowned', 'Walking Ballista'],
  ['Deadeye Navigator', 'Peregrine Drake'],
  ['Deadeye Navigator', 'Palinchron'],
  ['Deadeye Navigator', 'Great Whale'],
  ['Basalt Monolith', 'Rings of Brighthearth'],
  ['Basalt Monolith', 'Forsaken Monument'],
  ['Grim Monolith', 'Power Artifact'],
  ['Food Chain', 'Eternal Scourge'],
  ['Food Chain', 'Squee, the Immortal'],
  ['Niv-Mizzet, the Firemind', 'Curiosity'],
  ['Niv-Mizzet, Parun', 'Curiosity'],
  ['Niv-Mizzet, the Firemind', 'Ophidian Eye'],
  ['Niv-Mizzet, Parun', 'Ophidian Eye'],
  ['Dualcaster Mage', 'Twinflame'],
  ['Dualcaster Mage', 'Heat Shimmer'],
  ['Dualcaster Mage', 'Molten Duplication'],
  ['Worldgorger Dragon', 'Animate Dead'],
  ['Worldgorger Dragon', 'Dance of the Dead'],
  ["Painter's Servant", 'Grindstone'],
];

let memoryChangers: { at: number; names: Set<string> } | null = null;

export function bracketLabel(id: BracketId): string {
  return BRACKETS.find((item) => item.id === id)?.label ?? 'Any / no limit';
}

export function bracketLimits(id: BracketId | undefined): Limits | null {
  if (id == null || id === 'any' || id === 4 || id === 5) return null;
  if (id === 1) return { maxGameChangers: 0, maxExtraTurns: 0, maxFastMana: 0, allowMassLandDenial: false, allowCombos: false };
  if (id === 2) return { maxGameChangers: 0, maxExtraTurns: 1, maxFastMana: 2, allowMassLandDenial: false, allowCombos: false };
  return { maxGameChangers: 3, maxExtraTurns: 2, maxFastMana: 99, allowMassLandDenial: false, allowCombos: false };
}

export function detectSignals(card: { name: string; typeLine: string; oracleText: string; cmc: number }, gameChangers: Set<string>): CardSignals {
  const text = card.oracleText.toLowerCase();
  return {
    gameChanger: isGameChanger(card.name, gameChangers),
    massLandDenial: /destroy all lands|destroy each land|each player sacrifices (\d+|a|two|three) lands|all lands don't untap during/.test(text),
    extraTurn: /extra turn/.test(text),
    tutor: isTutor(text),
    fastMana: isFastMana(card),
  };
}

export function isGameChanger(name: string, gameChangers: Set<string>): boolean {
  const full = normalizeName(name);
  const front = normalizeName(name.split('//')[0] ?? name);
  return gameChangers.has(full) || gameChangers.has(front);
}

export function comboWith(name: string, chosen: Iterable<string>): string | null {
  const key = normalizeName(name);
  for (const other of chosen) {
    const pair = comboPartner(key, normalizeName(other));
    if (pair) return other;
  }
  return null;
}

export function bracketAdjustment(card: { edhrecRank: number | null; cmc: number; tutor?: boolean; fastMana?: boolean; gameChanger?: boolean }, bracket: BracketId | undefined): number {
  if (bracket == null || bracket === 'any' || bracket === 3) return 0;
  const staple = card.edhrecRank != null && card.edhrecRank < 500;
  if (bracket === 1) {
    return (staple ? -28 : 6) + (card.tutor ? -36 : 0) + (card.fastMana ? -40 : 0) + (card.cmc >= 4 ? 6 : 0);
  }
  if (bracket === 2) {
    return (staple ? -12 : 0) + (card.tutor ? -18 : 0) + (card.fastMana ? -8 : 0);
  }
  if (bracket === 4) {
    return (card.fastMana ? 22 : 0) + (card.tutor ? 18 : 0) + (card.gameChanger ? 16 : 0) + (card.cmc <= 2 ? 8 : 0);
  }
  return (card.fastMana ? 36 : 0) + (card.tutor ? 28 : 0) + (card.gameChanger ? 22 : 0) + (card.cmc <= 2 ? 14 : 0) + (card.cmc >= 5 ? -14 : 0);
}

export function skipReason(
  card: { name: string; gameChanger?: boolean; massLandDenial?: boolean; extraTurn?: boolean; fastMana?: boolean },
  bracket: BracketId | undefined,
  state: { gameChangers: number; extraTurns: number; fastMana: number; names: Iterable<string> },
): string | null {
  const limits = bracketLimits(bracket);
  if (!limits) return null;
  if (card.gameChanger && state.gameChangers >= limits.maxGameChangers) {
    return limits.maxGameChangers === 0 ? 'Game Changer' : `Game Changer (limit ${limits.maxGameChangers})`;
  }
  if (card.massLandDenial && !limits.allowMassLandDenial) return 'Mass land denial';
  if (card.extraTurn && state.extraTurns >= limits.maxExtraTurns) return 'Extra turn';
  if (card.fastMana && state.fastMana >= limits.maxFastMana) return 'Fast mana cap';
  if (!limits.allowCombos) {
    const partner = comboWith(card.name, state.names);
    if (partner) return `Two-card combo with ${partner}`;
  }
  return null;
}

export function reviewCards(cards: Array<{ name: string; typeLine: string; oracleText: string; cmc: number; gameChanger?: boolean }>, gameChangers: Set<string>): BracketReview {
  const signals = cards.map((card) => {
    const detected = detectSignals(card, gameChangers);
    return { name: card.name, ...detected, gameChanger: card.gameChanger || detected.gameChanger };
  });
  const names = signals.map((card) => card.name);
  const combos: Array<{ a: string; b: string }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      if (!comboPartner(normalizeName(names[i]), normalizeName(names[j]))) continue;
      const key = [names[i], names[j]].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      combos.push({ a: names[i], b: names[j] });
    }
  }
  const gameChangerNames = unique(signals.filter((card) => card.gameChanger).map((card) => card.name));
  const review: BracketReview = {
    estimated: 2,
    label: '',
    gameChangers: gameChangerNames,
    massLandDenial: unique(signals.filter((card) => card.massLandDenial).map((card) => card.name)),
    extraTurns: unique(signals.filter((card) => card.extraTurn).map((card) => card.name)),
    tutors: unique(signals.filter((card) => card.tutor).map((card) => card.name)),
    combos,
    fastMana: unique(signals.filter((card) => card.fastMana).map((card) => card.name)),
    notes: [],
  };
  let estimated: Exclude<BracketId, 'any'> = 1;
  if (review.tutors.length > 0 || review.fastMana.length > 0) estimated = 2;
  if (review.extraTurns.length > 0) estimated = Math.max(estimated, 2) as Exclude<BracketId, 'any'>;
  if (review.gameChangers.length > 0) estimated = 3;
  if (review.gameChangers.length > 3 || review.massLandDenial.length > 0 || review.combos.length > 0 || review.extraTurns.length > 2) estimated = 4;
  if (review.fastMana.length >= 4 && review.tutors.length >= 3 && review.gameChangers.length >= 6) estimated = 5;
  review.estimated = estimated;
  review.label = bracketLabel(estimated);
  return review;
}

export async function loadGameChangers(): Promise<Set<string>> {
  if (memoryChangers && Date.now() - memoryChangers.at < WEEK_MS) return memoryChangers.names;
  const cached = await readCache();
  if (cached && Date.now() - cached.fetchedAt < WEEK_MS) {
    memoryChangers = { at: cached.fetchedAt, names: toNameSet(cached.names) };
    return memoryChangers.names;
  }
  try {
    let names: string[] = [];
    for (let attempt = 0; attempt < 3 && names.length === 0; attempt += 1) {
      const cards = await searchOrdered('is:gamechanger', 'name');
      names = cards.map((card) => card.name);
    }
    if (names.length === 0) throw new Error('Scryfall returned no Game Changers.');
    const fetchedAt = Date.now();
    memoryChangers = { at: fetchedAt, names: toNameSet(names) };
    await writeCache({ fetchedAt, names });
    return memoryChangers.names;
  } catch (error) {
    console.warn(error);
    if (cached) {
      memoryChangers = { at: cached.fetchedAt, names: toNameSet(cached.names) };
      return memoryChangers.names;
    }
    return new Set();
  }
}

function comboPartner(left: string, right: string): boolean {
  return COMBO_PAIRS.some(([a, b]) => {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    return (left === na && right === nb) || (left === nb && right === na);
  });
}

function isTutor(text: string): boolean {
  if (!/search your library/.test(text)) return false;
  const basicOnly = /search your library for (up to (\w+|\d+) |a |an |two )?basic land/.test(text);
  const broader = /any card|a card\b|card with|nonbasic|any permanent|a permanent|an artifact|a creature|an enchantment|an instant|a sorcery|a planeswalker/.test(text);
  if (basicOnly && !broader) return false;
  return true;
}

function isFastMana(card: { name: string; typeLine: string; oracleText: string; cmc: number }): boolean {
  const text = card.oracleText.toLowerCase();
  const name = card.name.toLowerCase();
  if (card.typeLine.toLowerCase().includes('land')) {
    return /ancient tomb|city of traitors|gemstone caverns|crystal vein/.test(name)
      || (/add \{c\}\{c\}/.test(text) && /pay 2 life|deals 2 damage to you/.test(text));
  }
  if (card.cmc > 2) return false;
  return /add \{[wubrgc]\}\{[wubrgc]\}|add two mana|add three mana/.test(text);
}

function toNameSet(names: string[]): Set<string> {
  const set = new Set<string>();
  for (const name of names) {
    set.add(normalizeName(name));
    set.add(normalizeName(name.split('//')[0] ?? name));
  }
  return set;
}

function unique(names: string[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const name of names) {
    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(name);
  }
  return list;
}

async function readCache(): Promise<{ fetchedAt: number; names: string[] } | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const json = await idbGet(CACHE_KEY);
    if (!json) return null;
    const parsed = JSON.parse(json) as { fetchedAt?: number; names?: string[] };
    if (!parsed || !Array.isArray(parsed.names) || typeof parsed.fetchedAt !== 'number') return null;
    return { fetchedAt: parsed.fetchedAt, names: parsed.names };
  } catch {
    return null;
  }
}

async function writeCache(value: { fetchedAt: number; names: string[] }): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await idbSet(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mtg-collection', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    request.onerror = () => reject(request.error ?? new Error('cache'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbGet(key: string): Promise<string | null> {
  const db = await idbOpen();
  const value = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function idbSet(key: string, json: string): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(json, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
