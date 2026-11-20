import { normalizeName } from './text';
import { formatSpec, formatTarget, type DeckRecord } from './deckModel';

export type RoleId = 'land' | 'ramp' | 'draw' | 'removal' | 'wipe';
export type Level = 'low' | 'ok' | 'high';

export interface KnownCard {
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
  legality: string;
  edhrecRank: number | null;
  priceUsd: number | null;
  image: string;
  producedMana: string[];
  roles: RoleId[];
  owned?: boolean;
}

export interface RoleBar {
  id: RoleId;
  label: string;
  count: number;
  level: Level;
  min: number;
  max: number;
  detail: string;
}

export interface DeckSuggestion {
  name: string;
  reason: string;
  role: RoleId | 'other';
  price: number | null;
  image: string;
  owned: boolean;
  decks: string[];
}

export interface DeckSwap {
  cut: string;
  add: string;
  reason: string;
}

export interface FillGroup {
  role: string;
  cards: DeckSuggestion[];
}

export interface DeckReport {
  cardCount: number;
  target: number;
  averageMv: number;
  curve: number[];
  types: Array<{ label: string; count: number }>;
  pips: Record<string, number>;
  sources: Record<string, number>;
  issues: string[];
  roles: RoleBar[];
  health: number;
  landRecommend: number;
  adds: DeckSuggestion[];
  upgrades: DeckSuggestion[];
  cuts: DeckSuggestion[];
  swaps: DeckSwap[];
  missing: Array<{ name: string; qty: number; price: number | null; committed: number }>;
  missingCost: number;
  fill: FillGroup[];
  needed: number;
}

const TYPES = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land', 'Battle'];
const COLORS = ['W', 'U', 'B', 'R', 'G'];

export function inferRoles(typeLine: string, oracleText: string): RoleId[] {
  const type = typeLine.toLowerCase();
  const text = oracleText.toLowerCase();
  const roles: RoleId[] = [];
  if (type.includes('land')) return ['land'];
  if (/add \{[wubrgc]\}|add one mana|add two mana|search your library for (a |up to \w+ )?basic land/.test(text)) roles.push('ramp');
  if (/draw a card|draw two|draw three|draw cards|draw x card/.test(text)) roles.push('draw');
  if (/destroy all|exile all|all creatures|all permanents|each creature/.test(text)) roles.push('wipe');
  else if (/destroy target|exile target|deals? \d+ damage to (any target|target creature)|target creature gets -\d+\/-\d+/.test(text)) roles.push('removal');
  return roles;
}

export function mergeRoles(inferred: RoleId[], tagged: RoleId[]): RoleId[] {
  return [...new Set([...inferred, ...tagged])];
}

export function combinedIdentity(identities: string[][]): string[] {
  const present = new Set(identities.flat());
  return COLORS.filter((color) => present.has(color));
}

export function landRecommendation(format: DeckRecord['format'], averageMv: number, ramp: number): number {
  if (formatSpec(format).roles === 'sixty') {
    return clamp(Math.round(22 + (averageMv - 2.2) * 3), 20, 28);
  }
  let recommend = 36 + Math.round((averageMv - 3) * 2);
  recommend -= Math.round(Math.max(0, ramp - 8) / 2);
  return clamp(recommend, 30, 42);
}

export function analyzeDeck(input: {
  deck: DeckRecord;
  cards: KnownCard[];
  identity: string[];
  owned: KnownCard[];
  otherDecks: Array<{ id: string; name: string; names: string[] }>;
  upgrades: KnownCard[];
  budget: number;
}): DeckReport {
  const { deck, cards, identity, owned, otherDecks, upgrades, budget } = input;
  const target = formatTarget(deck.format);
  const cardCount = cards.reduce((sum, card) => sum + card.qty, 0);
  const commanderNames = new Set(deck.commanders.map((name) => normalizeName(name)));
  const nonlands = cards.filter((card) => !card.roles.includes('land') && !commanderNames.has(normalizeName(card.name)));
  const averageMv = nonlands.length
    ? nonlands.reduce((sum, card) => sum + card.cmc * card.qty, 0) / nonlands.reduce((sum, card) => sum + card.qty, 0)
    : 0;
  const curve = [0, 0, 0, 0, 0, 0, 0];
  for (const card of nonlands) curve[Math.min(6, Math.floor(card.cmc))] += card.qty;
  const types = TYPES.map((label) => ({
    label,
    count: cards.filter((card) => card.typeLine.split(/—|–/)[0]?.includes(label)).reduce((sum, card) => sum + card.qty, 0),
  })).filter((type) => type.count > 0);
  const pips: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const color of COLORS) {
    pips[color] = 0;
    sources[color] = 0;
  }
  for (const card of cards) {
    const matches = card.manaCost.match(/\{([WUBRG])\}/g) ?? [];
    for (const pip of matches) pips[pip[1]] += card.qty;
    if (card.roles.includes('land')) {
      const produced = card.producedMana.length ? card.producedMana : card.colorIdentity;
      for (const color of produced) if (sources[color] !== undefined) sources[color] += card.qty;
    }
  }

  const issues = listDeckIssues(deck, cards, identity);

  const ramp = countRole(cards, 'ramp');
  const landRecommend = landRecommendation(deck.format, averageMv, ramp);
  const bars = roleBars(deck.format, cards, landRecommend);
  const spec = formatSpec(deck.format);
  let health = 100;
  health -= Math.min(30, Math.abs(cardCount - (spec.exact ? target : Math.max(cardCount, target))));
  health -= issues.filter((issue) => /banned|not legal|outside/.test(issue)).length * 8;
  health -= bars.filter((bar) => bar.level === 'low').length * 6;
  health = clamp(health, 0, 100);

  const deckNames = new Set(cards.map((card) => normalizeName(card.name)));
  const adds = rankOwned(owned, deck, identity, bars, commanderNames, cards, otherDecks).slice(0, 12);
  const cuts = rankCuts(cards, deck, commanderNames, averageMv).slice(0, 8);
  const buy = upgrades
    .filter((card) => card.priceUsd != null && card.priceUsd <= budget)
    .filter((card) => !deckNames.has(normalizeName(card.name)))
    .filter((card) => !owned.some((item) => normalizeName(item.name) === normalizeName(card.name)))
    .filter((card) => deck.commanders.length === 0 || !formatSpec(deck.format).commander || card.colorIdentity.every((color) => identity.includes(color)))
    .slice(0, 8)
    .map((card) => ({
      name: card.name,
      reason: upgradeReason(card, bars),
      role: primaryRole(card.roles),
      price: card.priceUsd,
      image: card.image,
      owned: false,
      decks: [],
    }));
  const swaps = cuts.slice(0, 4).map((cut, index) => {
    const partner = adds.find((add) => add.role === cut.role) ?? adds[index] ?? adds[0];
    if (!partner) return null;
    return {
      cut: cut.name,
      add: partner.name,
      reason: partner.role === cut.role
        ? `Swap a weaker ${labelRole(cut.role)} for ${partner.name}, which ${partner.reason.charAt(0).toLowerCase()}${partner.reason.slice(1)}`
        : `Cut ${cut.name} and add ${partner.name}. ${partner.reason}`,
    };
  }).filter((swap): swap is DeckSwap => swap !== null);

  const ownedByName = new Map<string, number>();
  for (const card of owned) ownedByName.set(normalizeName(card.name), (ownedByName.get(normalizeName(card.name)) ?? 0) + card.qty);
  const missing = cards.filter((card) => (ownedByName.get(normalizeName(card.name)) ?? 0) < card.qty).map((card) => {
    const have = ownedByName.get(normalizeName(card.name)) ?? 0;
    const committed = otherDecks.reduce((sum, other) => sum + (other.names.filter((name) => normalizeName(name) === normalizeName(card.name)).length), 0);
    return { name: card.name, qty: card.qty - have, price: card.priceUsd, committed };
  });
  const missingCost = missing.reduce((sum, card) => sum + (card.price ?? 0) * card.qty, 0);
  const needed = Math.max(0, target - cardCount);
  const fill = needed > 0 ? groupFill(adds, needed) : [];

  return {
    cardCount,
    target,
    averageMv,
    curve,
    types,
    pips,
    sources,
    issues,
    roles: bars,
    health,
    landRecommend,
    adds,
    upgrades: buy,
    cuts,
    swaps,
    missing,
    missingCost,
    fill,
    needed,
  };
}

export function listDeckIssues(deck: DeckRecord, cards: KnownCard[], identity: string[]): string[] {
  const spec = formatSpec(deck.format);
  const issues: string[] = [];
  const commanderNames = new Set(deck.commanders.map((name) => normalizeName(name)));
  const hasCommander = deck.commanders.length > 0;
  for (const card of cards) {
    if (spec.legality && card.legality === 'banned') issues.push(`${card.name} is banned in ${spec.label}.`);
    else if (spec.legality && card.legality === 'not_legal') issues.push(`${card.name} is not legal in ${spec.label}.`);
    if (spec.commander && hasCommander && card.colorIdentity.some((color) => !identity.includes(color))) {
      issues.push(`${card.name} is outside the commander’s color identity.`);
    }
    const basic = /basic/i.test(card.typeLine);
    if (spec.singleton && !basic && card.qty > 1 && !commanderNames.has(normalizeName(card.name))) {
      issues.push(`${card.name} appears ${card.qty} times in a singleton format.`);
    }
    if (!spec.singleton && spec.legality && !basic && card.qty > 4) {
      issues.push(`${card.name} has ${card.qty} copies. ${spec.label} allows 4.`);
    }
  }
  const cardCount = cards.reduce((sum, card) => sum + card.qty, 0);
  const target = formatTarget(deck.format);
  const label = spec.label;
  const countsCommander = spec.commander;
  if (spec.exact && cardCount !== target) {
    issues.push(`${cardCount} cards. ${label} decks are ${target}${countsCommander ? ', including the commander' : ''}.`);
  }
  if (!spec.exact && cardCount < target) {
    issues.push(`${cardCount} cards. ${label} decks need at least ${target}.`);
  }
  return issues;
}

function countRole(cards: KnownCard[], role: RoleId): number {
  return cards.filter((card) => card.roles.includes(role)).reduce((sum, card) => sum + card.qty, 0);
}

function roleBars(format: DeckRecord['format'], cards: KnownCard[], landRecommend: number): RoleBar[] {
  const specs = formatSpec(format).roles === 'commander'
    ? [
        { id: 'land' as const, label: 'Lands', min: landRecommend - 1, max: landRecommend + 1, detail: `About ${landRecommend}, from the curve` },
        { id: 'ramp' as const, label: 'Ramp', min: 10, max: 16, detail: 'Aim for 10 or more' },
        { id: 'draw' as const, label: 'Draw', min: 10, max: 16, detail: 'Aim for 10 or more' },
        { id: 'removal' as const, label: 'Removal', min: 8, max: 12, detail: 'Aim for 8–10 targeted removal' },
        { id: 'wipe' as const, label: 'Wipes', min: 2, max: 4, detail: 'Aim for 2–3 board wipes' },
      ]
    : [
        { id: 'land' as const, label: 'Lands', min: landRecommend - 1, max: landRecommend + 2, detail: `About ${landRecommend} for this curve` },
        { id: 'ramp' as const, label: 'Ramp', min: 0, max: 6, detail: 'A little mana acceleration is enough' },
        { id: 'draw' as const, label: 'Draw', min: 4, max: 10, detail: 'Aim for several cantrips or engines' },
        { id: 'removal' as const, label: 'Removal', min: 4, max: 10, detail: 'Aim for a handful of answers' },
        { id: 'wipe' as const, label: 'Wipes', min: 0, max: 3, detail: 'Optional in a 60-card deck' },
      ];
  return specs.map((spec) => {
    const count = countRole(cards, spec.id);
    return { ...spec, count, level: count < spec.min ? 'low' : count > spec.max ? 'high' : 'ok' };
  });
}

function rankOwned(
  owned: KnownCard[],
  deck: DeckRecord,
  identity: string[],
  bars: RoleBar[],
  commanders: Set<string>,
  deckCards: KnownCard[],
  otherDecks: Array<{ id: string; name: string; names: string[] }>,
): DeckSuggestion[] {
  const inDeck = new Map<string, number>();
  for (const card of deckCards) inDeck.set(normalizeName(card.name), card.qty);
  const lowRoles = new Set(bars.filter((bar) => bar.level === 'low' && bar.id !== 'land').map((bar) => bar.id));
  const commanderText = deckCards.filter((card) => commanders.has(normalizeName(card.name))).map((card) => `${card.typeLine} ${card.oracleText} ${card.keywords.join(' ')}`).join(' ').toLowerCase();
  const scored = owned.map((card) => {
    const name = normalizeName(card.name);
    if (commanders.has(name)) return null;
    const have = inDeck.get(name) ?? 0;
    const spec = formatSpec(deck.format);
    if (spec.singleton && have > 0) return null;
    if (!spec.singleton && have >= 4) return null;
    if (spec.legality && (card.legality === 'banned' || card.legality === 'not_legal')) return null;
    if (spec.commander && deck.commanders.length > 0 && card.colorIdentity.some((color) => !identity.includes(color))) return null;
    let score = 1;
    const role = card.roles.find((item) => lowRoles.has(item)) ?? primaryRole(card.roles);
    if (role !== 'other' && lowRoles.has(role as RoleId)) score += 50;
    if (card.edhrecRank != null) score += Math.max(0, 24 - card.edhrecRank / 800);
    if (commanderText && card.keywords.some((keyword) => commanderText.includes(keyword.toLowerCase()))) score += 18;
    const tribe = creatureType(commanderText);
    if (tribe && card.typeLine.toLowerCase().includes(tribe)) score += 22;
    const decks = otherDecks.filter((other) => other.id !== deck.id && other.names.some((item) => normalizeName(item) === name)).map((other) => other.name);
    return { card, score, role, decks };
  }).filter((item): item is NonNullable<typeof item> => item !== null && item.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 24).map(({ card, role, decks }) => ({
    name: card.name,
    reason: addReason(card, role, bars),
    role,
    price: card.priceUsd,
    image: card.image,
    owned: true,
    decks,
  }));
}

function rankCuts(cards: KnownCard[], deck: DeckRecord, commanders: Set<string>, averageMv: number): DeckSuggestion[] {
  const cuts: Array<{ card: KnownCard; score: number; reason: string }> = [];
  for (const card of cards) {
    if (commanders.has(normalizeName(card.name))) continue;
    const basic = /basic/i.test(card.typeLine);
    const roles = card.roles.filter((role) => role !== 'land');
    if (formatSpec(deck.format).singleton && !basic && card.qty > 1) {
      cuts.push({ card, score: 80, reason: `Cut extras. Singleton decks only need one ${card.name}.` });
    }
    if (!card.roles.includes('land') && roles.length === 0 && card.cmc >= averageMv + 1.2) {
      cuts.push({ card, score: 40 + card.cmc, reason: `Mana value ${card.cmc.toFixed(0)} sits above the curve and it doesn’t ramp, draw, remove, or wipe.` });
    }
  }
  cuts.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return cuts.filter((cut) => {
    if (seen.has(cut.card.name)) return false;
    seen.add(cut.card.name);
    return true;
  }).map((cut) => ({
    name: cut.card.name,
    reason: cut.reason,
    role: primaryRole(cut.card.roles),
    price: cut.card.priceUsd,
    image: cut.card.image,
    owned: true,
    decks: [],
  }));
}

function groupFill(adds: DeckSuggestion[], needed: number): FillGroup[] {
  const groups = new Map<string, DeckSuggestion[]>();
  for (const add of adds) {
    const key = labelRole(add.role);
    groups.set(key, [...(groups.get(key) ?? []), add]);
  }
  let left = needed;
  const result: FillGroup[] = [];
  for (const [role, cards] of groups) {
    if (left <= 0) break;
    const take = cards.slice(0, Math.max(1, Math.ceil(left / Math.max(1, groups.size))));
    left -= take.length;
    result.push({ role, cards: take });
  }
  if (result.reduce((sum, group) => sum + group.cards.length, 0) < needed) {
    const used = new Set(result.flatMap((group) => group.cards.map((card) => card.name)));
    const rest = adds.filter((card) => !used.has(card.name)).slice(0, needed);
    if (rest.length) result.push({ role: 'More owned cards', cards: rest });
  }
  return result;
}

function addReason(card: KnownCard, role: RoleId | 'other', bars: RoleBar[]): string {
  const low = bars.find((bar) => bar.id === role && bar.level === 'low');
  const popular = card.edhrecRank != null ? ` EDHREC rank ${card.edhrecRank.toLocaleString('en-US')}.` : '';
  if (low) return `Fills ${low.label.toLowerCase()}, which is low at ${low.count}.${popular}`;
  if (role !== 'other') return `Adds another ${labelRole(role).toLowerCase()} you already own.${popular}`;
  return `A legal card you own that isn’t in this deck yet.${popular}`;
}

function upgradeReason(card: KnownCard, bars: RoleBar[]): string {
  const role = card.roles.find((item) => bars.some((bar) => bar.id === item && bar.level === 'low'));
  const price = card.priceUsd != null ? ` $${card.priceUsd.toFixed(2)}.` : '';
  if (role) return `You don’t own it, and it fills ${labelRole(role).toLowerCase()}.${price}`;
  return `Popular in this color identity and missing from your collection.${price}`;
}

function primaryRole(roles: RoleId[]): RoleId | 'other' {
  return roles.find((role) => role !== 'land') ?? 'other';
}

function labelRole(role: RoleId | 'other'): string {
  if (role === 'land') return 'Lands';
  if (role === 'ramp') return 'Ramp';
  if (role === 'draw') return 'Draw';
  if (role === 'removal') return 'Removal';
  if (role === 'wipe') return 'Wipes';
  return 'Other';
}

function creatureType(text: string): string {
  const match = text.match(/\b(goblin|zombie|vampire|wizard|dragon|necron|elf|human)\b/i);
  return match ? match[1].toLowerCase() : '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
