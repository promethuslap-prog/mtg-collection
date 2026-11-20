import { inferRoles, type RoleId } from './deckAnalyze';
import { formatSpec } from './deckModel';
import { normalizeName } from './text';

export type BuildFormat = 'commander' | 'standard' | 'pioneer' | 'modern' | 'casual';

export interface PoolCard {
  name: string;
  set: string;
  collectorNumber: string;
  qty: number;
  cmc: number;
  manaCost: string;
  typeLine: string;
  colorIdentity: string[];
  oracleText: string;
  keywords: string[];
  legalities: Record<string, string>;
  edhrecRank: number | null;
  image: string;
  producedMana: string[];
  roles: RoleId[];
  oracleId: string;
  scryfallUri: string;
  owned: boolean;
  inDecks: string[];
}

export interface BuildRequest {
  format: BuildFormat;
  commander: PoolCard | null;
  colors: string[];
  theme: string;
  onlyOwned: boolean;
  buyLimit: number;
  allowInOtherDecks: boolean;
  seed: number;
  extras?: PoolCard[];
}

export interface BuiltCard {
  card: PoolCard;
  qty: number;
  role: RoleId | 'threat';
  reason: string;
  toBuy: boolean;
}

export interface RoleCoverage {
  id: RoleId;
  label: string;
  count: number;
  aim: number;
  min: number;
  max: number;
  level: 'low' | 'ok' | 'high';
}

export interface BuiltDeck {
  name: string;
  format: BuildFormat;
  commander: PoolCard | null;
  commanderOwned: boolean;
  cards: BuiltCard[];
  curve: number[];
  roles: RoleCoverage[];
  colors: Record<string, number>;
  summary: string;
  fromCollection: number;
  mainSize: number;
  seed: number;
  toBuy: BuiltCard[];
}

export interface RankedCommander {
  card: PoolCard;
  playable: number;
  synergy: number;
  score: number;
}

const COLORS = ['W', 'U', 'B', 'R', 'G'];
const BASIC_NAME: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const BASIC_NAMES = new Set(Object.values(BASIC_NAME).map((name) => name.toLowerCase()));
const STOP = new Set(['that', 'with', 'your', 'this', 'from', 'each', 'target', 'card', 'cards', 'when', 'whenever', 'until', 'deals', 'damage', 'creature', 'creatures', 'player', 'players', 'control', 'onto', 'battlefield', 'then', 'they', 'them', 'have', 'gains', 'gain', 'loses', 'lose', 'where', 'number', 'equal', 'among', 'other']);

export function canBeCommander(card: PoolCard): boolean {
  const type = card.typeLine.toLowerCase();
  const text = `${card.oracleText} ${card.keywords.join(' ')}`.toLowerCase();
  const status = card.legalities.commander ?? '';
  if (status === 'banned' || status === 'not_legal') return false;
  if (type.includes('legendary') && type.includes('creature')) return true;
  return /can be your commander/.test(text);
}

export function rankOwnedCommanders(pool: PoolCard[], format: BuildFormat = 'commander'): RankedCommander[] {
  const commanders = pool.filter((card) => card.owned && card.qty > 0 && canBeCommander(card) && isLegal(card, format));
  const ranked = commanders.map((card) => {
    const playable = pool.filter((other) => other.owned && other.name !== card.name && fits(other, card.colorIdentity, format));
    const synergy = playable.filter((other) => synergyScore(other, card, '') > 0).length;
    const score = playable.length * 2 + synergy * 3 + quality(card);
    return { card, playable: playable.length, synergy, score };
  });
  ranked.sort((a, b) => b.score - a.score || b.playable - a.playable || a.card.name.localeCompare(b.card.name));
  return ranked;
}

export function suggestColors(pool: PoolCard[], format: BuildFormat, theme: string, seed: number): { colors: string[]; playable: number } {
  const options: string[][] = [];
  for (const color of COLORS) options.push([color]);
  for (let i = 0; i < COLORS.length; i += 1) {
    for (let j = i + 1; j < COLORS.length; j += 1) options.push([COLORS[i], COLORS[j]]);
  }
  const scored = options.map((colors) => {
    const playable = pool.filter((card) => card.owned && !isLand(card) && fits(card, colors, format));
    const perColor = colors.map((color) => playable.filter((card) => card.colorIdentity.includes(color)).length);
    const thin = Math.min(...perColor);
    const themeHits = theme.trim() ? playable.filter((card) => themeScore(card, theme) > 0).length : 0;
    const score = (colors.length > 1 && thin < 8 ? thin : playable.length) + themeHits * 2;
    return { colors, playable: playable.length, score };
  });
  scored.sort((a, b) => b.score - a.score || a.colors.join('').localeCompare(b.colors.join('')));
  const best = scored[0]?.score ?? 0;
  const band = scored.filter((item) => item.score >= best - 1);
  const rng = mulberry32(seed || 1);
  const pick = band[Math.floor(rng() * band.length)] ?? scored[0];
  return { colors: pick?.colors ?? ['R'], playable: pick?.playable ?? 0 };
}

export function buildDeck(pool: PoolCard[], request: BuildRequest): BuiltDeck {
  const format = request.format;
  const spec = formatSpec(format);
  const mainSize = spec.commander ? 99 : 60;
  const commander = request.commander;
  const colors = commander ? commander.colorIdentity : request.colors.length ? request.colors : suggestColors(pool, format, request.theme, request.seed).colors;
  const identity = [...colors];
  const buyLimit = request.onlyOwned ? 0 : Math.max(0, Math.floor(request.buyLimit));
  const rng = mulberry32(request.seed || 1);
  const used = new Set<string>();
  if (commander) used.add(normalizeName(commander.name));

  const available = [...pool, ...(request.extras ?? [])].filter((card) => {
    if (used.has(normalizeName(card.name))) return false;
    if (!card.owned && buyLimit <= 0) return false;
    if (!request.allowInOtherDecks && card.inDecks.length > 0 && !isBasic(card)) return false;
    return fits(card, identity, format) || (isBasic(card) && identity.includes(basicColor(card) ?? ''));
  });
  const ownedByName = new Map<string, PoolCard>();
  for (const card of available) {
    const key = normalizeName(card.name);
    const existing = ownedByName.get(key);
    if (!existing || (card.owned && !existing.owned) || card.qty > existing.qty) ownedByName.set(key, card);
  }
  const unique = [...ownedByName.values()];
  const nonlands = unique.filter((card) => !isLand(card));
  const nonbasics = unique.filter((card) => isLand(card) && !isBasic(card));

  const initialLands = spec.commander ? 34 : 24;
  let nonlandSlots = mainSize - initialLands;
  const chosen: BuiltCard[] = [];
  let buys = 0;
  const counts: Record<RoleId, number> = { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0 };
  const curve = [0, 0, 0, 0, 0, 0, 0];

  const aims: Record<RoleId, number> = spec.commander
    ? { land: initialLands, ramp: 11, draw: 10, removal: 9, wipe: 3 }
    : { land: initialLands, ramp: 4, draw: 6, removal: 6, wipe: 1 };

  function slots() {
    return chosen.reduce((sum, card) => sum + card.qty, 0);
  }

  function take(card: PoolCard, role: RoleId | 'threat') {
    if (!card.owned) {
      if (buys >= buyLimit) return false;
      buys += 1;
    }
    const room = nonlandSlots - slots();
    if (room <= 0) return false;
    const qty = copyCount(card, format, room);
    chosen.push(toBuilt(card, qty, role, reasonFor(card, role, commander, request.theme)));
    used.add(normalizeName(card.name));
    for (const item of card.roles) counts[item] += qty;
    curve[Math.min(6, Math.floor(card.cmc))] += qty;
    return true;
  }

  function candidates(role: RoleId | 'threat') {
    return nonlands.filter((card) => !used.has(normalizeName(card.name)) && (card.owned || buys < buyLimit)).map((card) => ({
      card,
      score: baseScore(card, commander, request.theme, curve, nonlandSlots)
        + (role !== 'threat' && card.roles.includes(role) ? 28 : 0)
        - (role === 'threat' ? card.roles.reduce((penalty, item) => penalty + (item !== 'land' && counts[item] >= aims[item] ? 18 : 0), 0) : 0),
    })).sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name));
  }

  for (const role of ['ramp', 'draw', 'removal', 'wipe'] as const) {
    while (counts[role] < aims[role] && slots() < nonlandSlots) {
      const options = candidates(role).filter((item) => item.card.roles.includes(role));
      const next = pickNear(options, rng);
      if (!next || !take(next.card, role)) break;
    }
  }
  while (slots() < nonlandSlots) {
    const next = pickNear(candidates('threat'), rng);
    if (!next || !take(next.card, primaryRole(next.card))) break;
  }

  const avg = averageCmc(chosen);
  const landTarget = landCount(format, avg, counts.ramp);
  const wantedSpells = mainSize - landTarget;
  nonlandSlots = wantedSpells;
  while (slots() > wantedSpells) dropOne(chosen, used, counts, curve);
  while (slots() < wantedSpells) {
    const next = pickNear(candidates('threat'), rng);
    if (!next || !take(next.card, primaryRole(next.card))) break;
  }

  const pips = pipCounts(chosen);
  const landSlots = mainSize - slots();
  const reservedBasics = Math.min(landSlots, Math.max(identity.length || 1, Math.round(landSlots * 0.45)));
  const nonbasicRoom = Math.max(0, landSlots - reservedBasics);
  const landOptions = nonbasics
    .filter((card) => !used.has(normalizeName(card.name)) && (card.owned || buys < buyLimit))
    .map((card) => ({ card, score: landScore(card, identity) }))
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name));
  let utility = 0;
  let nonbasicTaken = 0;
  for (const option of landOptions) {
    if (nonbasicTaken >= nonbasicRoom) break;
    const produced = producedColors(option.card);
    const onColor = produced.filter((color) => identity.includes(color));
    const utilityLand = onColor.length === 0;
    if (utilityLand) {
      if (utility >= 3 || option.card.colorIdentity.some((color) => !identity.includes(color))) continue;
      utility += 1;
    }
    if (!option.card.owned) {
      if (buys >= buyLimit) continue;
      buys += 1;
    }
    chosen.push(toBuilt(option.card, 1, 'land', landReason(option.card, identity)));
    used.add(normalizeName(option.card.name));
    counts.land += 1;
    nonbasicTaken += 1;
  }

  const basicsNeeded = mainSize - chosen.reduce((sum, card) => sum + card.qty, 0);
  const allocation = allocateBasics(basicsNeeded, identity.length ? identity : ['C'], pips, request.seed);
  for (const [color, qty] of allocation) {
    if (qty <= 0) continue;
    const ownedPrinting = pool.find((card) => card.name.toLowerCase() === (BASIC_NAME[color] ?? '').toLowerCase());
    chosen.push(toBuilt(makeBasic(color, ownedPrinting), qty, 'land', color === 'C'
      ? 'Colorless basics to finish the mana base.'
      : `Basic ${BASIC_NAME[color]} to match the deck’s mana pips.`));
    counts.land += qty;
  }

  const trimmed = fitExact(chosen, mainSize, identity, pips, pool);
  return present(trimmed, commander, format, identity, request.seed, request.theme);
}

export function swapBuiltCard(built: BuiltDeck, name: string, pool: PoolCard[], request: BuildRequest): BuiltDeck {
  const target = built.cards.find((card) => normalizeName(card.card.name) === normalizeName(name));
  if (!target || isBasic(target.card)) return built;
  const identity = built.commander ? built.commander.colorIdentity : request.colors;
  const used = new Set(built.cards.map((card) => normalizeName(card.card.name)));
  if (built.commander) used.add(normalizeName(built.commander.name));
  const options = pool.filter((card) => {
    if (used.has(normalizeName(card.name)) || isBasic(card) || isLand(card) !== (target.role === 'land')) return false;
    if (!card.owned && request.onlyOwned) return false;
    if (!request.allowInOtherDecks && card.inDecks.length > 0) return false;
    return fits(card, identity, built.format);
  });
  const sameRole = options.filter((card) => target.role === 'threat' || target.role === 'land' || card.roles.includes(target.role));
  const ranked = (sameRole.length ? sameRole : options)
    .map((card) => ({ card, score: baseScore(card, built.commander, request.theme, [0, 0, 0, 0, 0, 0, 0], built.mainSize) }))
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name));
  const next = ranked.find((item) => normalizeName(item.card.name) !== normalizeName(name));
  if (!next) return built;
  const qty = copyCount(next.card, built.format, target.qty);
  const cards = built.cards.filter((card) => normalizeName(card.card.name) !== normalizeName(name));
  cards.push(toBuilt(next.card, qty, target.role === 'land' ? 'land' : primaryRole(next.card), `Next owned alternative for this slot. ${reasonFor(next.card, primaryRole(next.card), built.commander, request.theme)}`));
  const pips = pipCounts(cards.filter((card) => !isLand(card.card)));
  const fitted = fitExact(cards, built.mainSize, identity, pips, pool);
  return present(fitted, built.commander, built.format, identity, built.seed, request.theme);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function present(cards: BuiltCard[], commander: PoolCard | null, format: BuildFormat, identity: string[], seed: number, theme: string): BuiltDeck {
  const mainSize = formatSpec(format).commander ? 99 : 60;
  const curve = [0, 0, 0, 0, 0, 0, 0];
  for (const card of cards) {
    if (!isLand(card.card)) curve[Math.min(6, Math.floor(card.card.cmc))] += card.qty;
  }
  const counts: Record<RoleId, number> = { land: 0, ramp: 0, draw: 0, removal: 0, wipe: 0 };
  for (const card of cards) {
    if (isLand(card.card) || card.role === 'land') counts.land += card.qty;
    for (const role of card.card.roles) if (role !== 'land') counts[role] += card.qty;
  }
  const avg = averageCmc(cards.filter((card) => !isLand(card.card)));
  const landAim = landCount(format, avg, counts.ramp);
  const roles = coverage(format, counts, landAim);
  const colors: Record<string, number> = {};
  for (const color of COLORS) colors[color] = 0;
  for (const card of cards) {
    const matches = card.card.manaCost.match(/\{([WUBRG])\}/g) ?? [];
    for (const pip of matches) colors[pip[1]] += card.qty;
  }
  const fromCollection = cards.reduce((sum, card) => sum + (card.toBuy ? 0 : card.qty), 0);
  const low = roles.filter((role) => role.level === 'low' && role.id !== 'land').map((role) => role.label.toLowerCase());
  const toBuy = cards.filter((card) => card.toBuy);
  const commanderOwned = commander ? commander.owned : true;
  const landRole = roles.find((role) => role.id === 'land');
  let summary = `${fromCollection} of ${mainSize} from your collection`;
  if (low.length) summary += `; low on ${low.join(' and ')}`;
  if (landRole && landRole.count > landRole.max) summary += `; ${landRole.count - landRole.aim} extra lands because the owned spell pool ran out`;
  if (!commanderOwned && commander) summary += `. ${commander.name} is not in your collection`;
  const name = commander
    ? `${commander.name} built`
    : `${identity.join('') || 'Suggested'}${theme.trim() ? ` ${theme.trim()}` : ''} deck`;
  return {
    name,
    format,
    commander,
    commanderOwned,
    cards,
    curve,
    roles,
    colors,
    summary,
    fromCollection,
    mainSize,
    seed,
    toBuy,
  };
}

function coverage(format: BuildFormat, counts: Record<RoleId, number>, landAim: number): RoleCoverage[] {
  const commander = formatSpec(format).roles === 'commander';
  const specs: Array<Omit<RoleCoverage, 'count' | 'level'>> = commander
    ? [
        { id: 'land', label: 'Lands', aim: landAim, min: landAim - 2, max: landAim + 2 },
        { id: 'ramp', label: 'Ramp', aim: 11, min: 10, max: 12 },
        { id: 'draw', label: 'Draw', aim: 10, min: 10, max: 14 },
        { id: 'removal', label: 'Removal', aim: 9, min: 8, max: 10 },
        { id: 'wipe', label: 'Wipes', aim: 3, min: 2, max: 4 },
      ]
    : [
        { id: 'land', label: 'Lands', aim: landAim, min: 22, max: 26 },
        { id: 'ramp', label: 'Ramp', aim: 4, min: 2, max: 6 },
        { id: 'draw', label: 'Draw', aim: 6, min: 4, max: 8 },
        { id: 'removal', label: 'Removal', aim: 6, min: 4, max: 8 },
        { id: 'wipe', label: 'Wipes', aim: 1, min: 0, max: 2 },
      ];
  return specs.map((spec) => {
    const count = counts[spec.id];
    const level = count < spec.min ? 'low' : count > spec.max ? 'high' : 'ok';
    return { ...spec, count, level };
  });
}

function landCount(format: BuildFormat, average: number, ramp: number): number {
  if (formatSpec(format).roles === 'sixty') return clamp(Math.round(23 + (average - 2.2) * 2), 22, 26);
  let recommend = 33 + Math.round((average - 3) * 2);
  recommend -= Math.round(Math.max(0, ramp - 8) / 3);
  return clamp(recommend, 30, 36);
}

function fitExact(cards: BuiltCard[], mainSize: number, identity: string[], pips: Record<string, number>, pool: PoolCard[]): BuiltCard[] {
  const list = cards.map((card) => ({ ...card }));
  const size = () => list.reduce((sum, card) => sum + card.qty, 0);
  while (size() > mainSize) {
    const basic = [...list].reverse().find((card) => isBasic(card.card) && card.qty > 0);
    const threat = [...list].reverse().find((card) => card.role === 'threat' && !isBasic(card.card));
    const victim = basic && size() - mainSize < 8 ? basic : threat ?? basic ?? list[list.length - 1];
    if (!victim) break;
    victim.qty -= 1;
    if (victim.qty <= 0) list.splice(list.indexOf(victim), 1);
  }
  while (size() < mainSize) {
    const color = nextBasicColor(identity, pips, list);
    const name = BASIC_NAME[color] ?? 'Wastes';
    const existing = list.find((card) => card.card.name === name);
    if (existing) existing.qty += 1;
    else {
      const ownedPrinting = pool.find((card) => card.name === name);
      list.push(toBuilt(makeBasic(color, ownedPrinting), 1, 'land', color === 'C' ? 'Colorless basics to finish the mana base.' : `Basic ${name} to match the deck’s mana pips.`));
    }
  }
  return list.filter((card) => card.qty > 0);
}

function dropOne(chosen: BuiltCard[], used: Set<string>, counts: Record<RoleId, number>, curve: number[]) {
  const threats = chosen.filter((card) => card.role === 'threat' && !isLand(card.card));
  const victim = threats[threats.length - 1] ?? chosen[chosen.length - 1];
  if (!victim) return;
  victim.qty -= 1;
  for (const role of victim.card.roles) counts[role] = Math.max(0, counts[role] - 1);
  curve[Math.min(6, Math.floor(victim.card.cmc))] = Math.max(0, curve[Math.min(6, Math.floor(victim.card.cmc))] - 1);
  if (victim.qty <= 0) {
    chosen.splice(chosen.indexOf(victim), 1);
    used.delete(normalizeName(victim.card.name));
  }
}

function pickNear(options: Array<{ card: PoolCard; score: number }>, rng: () => number): { card: PoolCard; score: number } | null {
  if (options.length === 0) return null;
  const best = options[0].score;
  const window = options.filter((item) => item.score >= best - 6);
  return window[Math.floor(rng() * window.length)] ?? options[0];
}

function copyCount(card: PoolCard, format: BuildFormat, room: number): number {
  if (isBasic(card)) return Math.max(1, Math.min(room, 1));
  if (formatSpec(format).singleton || !card.owned) return 1;
  return Math.max(1, Math.min(4, card.qty, room));
}

function toBuilt(card: PoolCard, qty: number, role: RoleId | 'threat', reason: string): BuiltCard {
  return { card, qty, role, reason, toBuy: !card.owned };
}

function baseScore(card: PoolCard, commander: PoolCard | null, theme: string, curve: number[], nonlandSlots: number): number {
  let score = quality(card);
  score += synergyScore(card, commander, theme);
  score += themeScore(card, theme);
  const bucket = Math.min(6, Math.floor(card.cmc));
  const caps = [0.05, 0.12, 0.22, 0.22, 0.16, 0.12, 0.1];
  const cap = Math.max(1, Math.round(nonlandSlots * caps[bucket]));
  if (bucket <= 1) score += 6;
  if (bucket === 2 || bucket === 3) score += 14;
  if (bucket === 4) score += 4;
  if (bucket >= 6) score -= 8;
  if ((curve[bucket] ?? 0) >= cap) score -= 12;
  return score;
}

function synergyScore(card: PoolCard, commander: PoolCard | null, theme: string): number {
  if (!commander) return themeScore(card, theme) > 0 ? 8 : 0;
  const types = creatureTypes(commander.typeLine);
  const cardTypes = new Set(creatureTypes(card.typeLine));
  let score = 0;
  for (const type of types) {
    if (cardTypes.has(type) || card.oracleText.toLowerCase().includes(type)) score += 22;
  }
  const words = notableWords(commander.oracleText);
  const text = card.oracleText.toLowerCase();
  if (words.some((word) => text.includes(word))) score += 8;
  return Math.min(score, 44);
}

function themeScore(card: PoolCard, theme: string): number {
  const needle = theme.trim().toLowerCase();
  if (!needle) return 0;
  const blob = `${card.typeLine} ${card.oracleText} ${card.keywords.join(' ')} ${card.roles.join(' ')}`.toLowerCase();
  if (blob.includes(needle)) return 24;
  const stem = needle.endsWith('s') ? needle.slice(0, -1) : needle;
  if (stem.length > 3 && blob.includes(stem)) return 20;
  return 0;
}

function quality(card: PoolCard): number {
  if (card.edhrecRank == null) return 4;
  return Math.max(0, 18 - card.edhrecRank / 500);
}

function reasonFor(card: PoolCard, role: RoleId | 'threat', commander: PoolCard | null, theme: string): string {
  const parts: string[] = [];
  if (role === 'ramp' || role === 'draw' || role === 'removal' || role === 'wipe') parts.push(`Fills ${role}, which the deck still needs.`);
  else if (card.cmc <= 3) parts.push('Low on the curve, where the deck wants its peak.');
  else parts.push('A threat that still fits the curve.');
  const shared = commander ? creatureTypes(commander.typeLine).filter((type) => creatureTypes(card.typeLine).includes(type) || card.oracleText.toLowerCase().includes(type)) : [];
  if (shared.length) parts.push(`Shares ${shared[0]} with ${commander?.name}.`);
  else if (themeScore(card, theme) > 0) parts.push(`Matches the ${theme.trim()} theme.`);
  if (card.edhrecRank != null && card.edhrecRank < 2500) parts.push('Widely played in similar decks.');
  if (card.inDecks.length) parts.push(`Also in ${card.inDecks.join(', ')}.`);
  if (!card.owned) parts.push('Not in your collection.');
  return parts.join(' ');
}

function landReason(card: PoolCard, identity: string[]): string {
  const colors = producedColors(card).filter((color) => identity.includes(color));
  if (colors.length === 0) return 'Colorless utility land that stays inside the color identity.';
  return `Owned land that produces ${colors.join(' and ')}.`;
}

function landScore(card: PoolCard, identity: string[]): number {
  const colors = producedColors(card).filter((color) => identity.includes(color));
  let score = colors.length * 12 + quality(card);
  if (colors.length > 1) score += 10;
  if (colors.length === 0 && card.colorIdentity.length === 0) score += 5;
  return score;
}

function producedColors(card: PoolCard): string[] {
  const source = card.producedMana.length ? card.producedMana : card.colorIdentity;
  return COLORS.filter((color) => source.includes(color));
}

function allocateBasics(count: number, identity: string[], pips: Record<string, number>, seed: number): Array<[string, number]> {
  if (count <= 0) return [];
  const colors = identity.filter((color) => color !== 'C');
  if (colors.length === 0) return [['C', count]];
  const weights = colors.map((color) => Math.max(1, pips[color] ?? 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (count * weight) / total);
  const qty = raw.map((value) => Math.floor(value));
  let left = count - qty.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || ((seed + a.index) % 2) - ((seed + b.index) % 2));
  for (const item of order) {
    if (left <= 0) break;
    qty[item.index] += 1;
    left -= 1;
  }
  return colors.map((color, index) => [color, qty[index]] as [string, number]).filter((item) => item[1] > 0);
}

function nextBasicColor(identity: string[], pips: Record<string, number>, list: BuiltCard[]): string {
  const colors = identity.filter((color) => BASIC_NAME[color]);
  if (colors.length === 0) return 'C';
  const have: Record<string, number> = {};
  for (const color of colors) have[color] = 0;
  for (const card of list) {
    if (!isBasic(card.card)) continue;
    const color = basicColor(card.card);
    if (color && have[color] !== undefined) have[color] += card.qty;
  }
  return [...colors].sort((a, b) => {
    const needA = (pips[a] ?? 1) / Math.max(1, have[a]);
    const needB = (pips[b] ?? 1) / Math.max(1, have[b]);
    return needB - needA || a.localeCompare(b);
  })[0];
}

function makeBasic(color: string, owned?: PoolCard): PoolCard {
  const name = BASIC_NAME[color] ?? 'Wastes';
  const type = color === 'C' ? 'Basic Land — Wastes' : `Basic Land — ${name}`;
  return {
    name,
    set: owned?.set ?? '',
    collectorNumber: owned?.collectorNumber ?? '',
    qty: 99,
    cmc: 0,
    manaCost: '',
    typeLine: type,
    colorIdentity: color === 'C' ? [] : [color],
    oracleText: color === 'C' ? '' : `{T}: Add {${color}}.`,
    keywords: [],
    legalities: { commander: 'legal', standard: 'legal', pioneer: 'legal', modern: 'legal' },
    edhrecRank: null,
    image: owned?.image ?? '',
    producedMana: color === 'C' ? ['C'] : [color],
    roles: ['land'],
    oracleId: owned?.oracleId ?? '',
    scryfallUri: owned?.scryfallUri ?? `https://scryfall.com/search?q=${encodeURIComponent(`!"${name}"`)}`,
    owned: true,
    inDecks: [],
  };
}

function fits(card: PoolCard, identity: string[], format: BuildFormat): boolean {
  if (!isLegal(card, format)) return false;
  if (isBasic(card)) return identity.includes(basicColor(card) ?? '');
  return card.colorIdentity.every((color) => identity.includes(color));
}

function isLegal(card: PoolCard, format: BuildFormat): boolean {
  const key = formatSpec(format).legality;
  if (!key) return true;
  const status = card.legalities[key] ?? '';
  return status !== 'banned' && status !== 'not_legal' && status !== '';
}

function isLand(card: PoolCard): boolean {
  return card.roles.includes('land') || card.typeLine.toLowerCase().includes('land');
}

function isBasic(card: PoolCard): boolean {
  return BASIC_NAMES.has(card.name.toLowerCase()) || /basic land/i.test(card.typeLine);
}

function basicColor(card: PoolCard): string | null {
  const found = Object.entries(BASIC_NAME).find(([, name]) => name.toLowerCase() === card.name.toLowerCase());
  return found ? found[0] : null;
}

function creatureTypes(typeLine: string): string[] {
  const face = typeLine.split('//')[0] ?? typeLine;
  const side = face.split(/—|–/)[1] ?? '';
  return side.toLowerCase().split(/[^a-z]+/).filter((type) => type.length > 2);
}

function notableWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z'+]+/).filter((word) => word.length > 4 && !STOP.has(word)))].slice(0, 8);
}

function pipCounts(cards: BuiltCard[]): Record<string, number> {
  const pips: Record<string, number> = {};
  for (const color of COLORS) pips[color] = 0;
  for (const card of cards) {
    const matches = card.card.manaCost.match(/\{([WUBRG])\}/g) ?? [];
    for (const pip of matches) pips[pip[1]] += card.qty;
  }
  return pips;
}

function averageCmc(cards: BuiltCard[]): number {
  const qty = cards.reduce((sum, card) => sum + card.qty, 0);
  if (!qty) return 3;
  return cards.reduce((sum, card) => sum + card.card.cmc * card.qty, 0) / qty;
}

function primaryRole(card: PoolCard): RoleId | 'threat' {
  return card.roles.find((role) => role !== 'land') ?? 'threat';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function rolesForCard(typeLine: string, oracleText: string, tagged: RoleId[] = []): RoleId[] {
  const roles = new Set<RoleId>([...inferRoles(typeLine, oracleText), ...tagged]);
  return [...roles];
}
