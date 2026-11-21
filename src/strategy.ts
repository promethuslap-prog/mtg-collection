import type { BuiltDeck } from './deckBuild';

export interface StrategySource {
  name: string;
  qty: number;
  cmc: number;
  typeLine: string;
  oracleText: string;
  keywords: string[];
  roles: string[];
  colors?: string[];
}

export interface StrategyBracket {
  label: string;
  estimated: number;
  gameChangers: string[];
  tutors: string[];
  fastMana: string[];
  extraTurns: string[];
  massLandDenial: string[];
  combos: Array<{ a: string; b: string }>;
}

export interface DeckStrategy {
  archetype: string;
  overview: string;
  early: string;
  mid: string;
  late: string;
  synergies: string[];
  wins: string[];
  mulligan: string;
  strengths: string;
  weaknesses: string;
  playAround: string;
  bracketNote: string;
  notes?: string;
}

const GENERIC_TYPES = new Set([
  'human', 'wizard', 'warrior', 'soldier', 'scout', 'shaman', 'cleric', 'knight', 'noble',
  'pirate', 'rogue', 'berserker', 'ally', 'advisor', 'mercenary', 'god', 'avatar', 'spirit',
]);

export function describeDeck(input: {
  commanders: StrategySource[];
  cards: StrategySource[];
  roles?: Array<{ id: string; label: string; level: string; count: number }>;
  bracket?: StrategyBracket | null;
}): DeckStrategy {
  const commanders = unique(input.commanders.filter((card) => card.name.trim()));
  const library = unique([...commanders, ...input.cards.filter((card) => card.name.trim())]);
  const names = new Set(library.map((card) => card.name.toLowerCase()));
  const inDeck = (name: string) => names.has(name.toLowerCase());
  const commanderNames = new Set(commanders.map((card) => card.name.toLowerCase()));
  const facts = library.map((card) => annotate(card, commanderNames.has(card.name.toLowerCase())));
  const tribe = dominantTribe(facts, commanders);
  const archetype = chooseArchetype(facts, commanders, tribe);
  const tokens = facts.filter((fact) => fact.tokens && !fact.commander).sort(byCurve);
  const ramp = facts.filter((fact) => fact.ramp && !fact.land && !fact.commander).sort(byCurve);
  const engines = facts.filter((fact) => !fact.commander && !fact.land && isEngine(fact, tribe, archetype)).sort(byEngine);
  const finishers = facts.filter((fact) => !fact.commander && !fact.land && (fact.youWin || fact.cmc >= 5) && (matchesPlan(fact, archetype, tribe) || fact.youWin)).sort(byFinisher);
  const combos = (input.bracket?.combos ?? []).filter((combo) => inDeck(combo.a) && inDeck(combo.b));
  const earlyNames = take(ramp.filter((fact) => fact.cmc <= 3), 3).map((fact) => fact.card.name);
  const setup = engines.find((fact) => fact.cmc <= 3 && !earlyNames.includes(fact.card.name));
  const midNames = take(engines.filter((fact) => !earlyNames.includes(fact.card.name)), 3).map((fact) => fact.card.name);
  const latePool = finishers.filter((fact) => !earlyNames.includes(fact.card.name) && !midNames.includes(fact.card.name));
  const lateNames = take(latePool.length ? latePool : facts.filter((fact) => !fact.land && !fact.commander && fact.cmc >= 4), 3).map((fact) => fact.card.name);
  const synergies = synergyLines(facts, commanders, tribe, tokens, combos).slice(0, 5);
  const wins = winLines(facts, commanders, archetype, combos, lateNames);
  const roleNote = roleNotes(input.roles ?? [], facts, archetype);
  const overview = overviewText(archetype, commanders, facts, wins);
  return {
    archetype,
    overview,
    early: earlyText(earlyNames, setup?.card.name),
    mid: midText(midNames, archetype),
    late: lateText(lateNames, archetype),
    synergies,
    wins,
    mulligan: mulliganText(ramp, engines),
    strengths: roleNote.strengths,
    weaknesses: roleNote.weaknesses,
    playAround: roleNote.playAround,
    bracketNote: bracketText(input.bracket ?? null, library),
  };
}

export function describeBuilt(deck: BuiltDeck): DeckStrategy {
  const face = (card: BuiltDeck['commander']): StrategySource | null => card ? sourceOf(card) : null;
  const commanders = [face(deck.commander), face(deck.partner ?? null)].filter((card): card is StrategySource => Boolean(card));
  return describeDeck({
    commanders,
    cards: deck.cards.map((card) => ({ ...sourceOf(card.card), qty: card.qty })),
    roles: deck.roles.map((role) => ({ id: role.id, label: role.label, level: role.level, count: role.count })),
    bracket: deck.check ? {
      label: deck.check.label,
      estimated: deck.check.estimated,
      gameChangers: deck.check.gameChangers,
      tutors: deck.check.tutors,
      fastMana: deck.check.fastMana,
      extraTurns: deck.check.extraTurns,
      massLandDenial: deck.check.massLandDenial,
      combos: deck.check.combos,
    } : null,
  });
}

export function strategyBlurb(strategy: DeckStrategy): string {
  const overview = strategy.notes?.trim() || strategy.overview;
  const sentence = overview.split(/(?<=[.!?])\s/)[0] ?? overview;
  return `${strategy.archetype}. ${sentence}`;
}

export function strategyComments(strategy: DeckStrategy): string {
  const overview = strategy.notes?.trim() || strategy.overview;
  return [
    `// ${strategy.archetype}`,
    `// ${overview}`,
    `// Early: ${strategy.early}`,
    `// Mid: ${strategy.mid}`,
    `// Late: ${strategy.late}`,
    ...strategy.synergies.map((line) => `// Synergy: ${line}`),
    ...strategy.wins.map((line) => `// Win: ${line}`),
    `// Mulligan: ${strategy.mulligan}`,
    `// ${strategy.strengths}`,
    `// ${strategy.weaknesses}`,
    `// ${strategy.playAround}`,
    `// ${strategy.bracketNote}`,
  ].join('\n');
}

export function sameStrategy(left: DeckStrategy | undefined, right: DeckStrategy): boolean {
  if (!left) return false;
  return left.archetype === right.archetype
    && left.overview === right.overview
    && left.early === right.early
    && left.mid === right.mid
    && left.late === right.late
    && left.synergies.join('|') === right.synergies.join('|')
    && left.wins.join('|') === right.wins.join('|');
}

interface Fact {
  card: StrategySource;
  text: string;
  typeLine: string;
  commander: boolean;
  land: boolean;
  creature: boolean;
  artifact: boolean;
  spell: boolean;
  equipment: boolean;
  aura: boolean;
  tokens: boolean;
  outlet: boolean;
  dies: boolean;
  etbDamage: boolean;
  eachDamage: boolean;
  ramp: boolean;
  draw: boolean;
  reducer: boolean;
  haste: boolean;
  youWin: boolean;
  types: string[];
  cmc: number;
}

function annotate(card: StrategySource, commander = false): Fact {
  const text = `${card.oracleText}\n${card.keywords.join('\n')}`.toLowerCase();
  const typeLine = card.typeLine.toLowerCase();
  return {
    card,
    text,
    typeLine,
    commander,
    land: typeLine.includes('land') || card.roles.includes('land'),
    creature: typeLine.includes('creature'),
    artifact: typeLine.includes('artifact') && !typeLine.includes('land'),
    spell: /instant|sorcery/.test(typeLine),
    equipment: typeLine.includes('equipment'),
    aura: typeLine.includes('aura'),
    tokens: /create (?:a |an |one |two |three |four |x |\d+ )?[^.]*token/.test(text),
    outlet: /sacrifice a (?:creature|artifact|permanent)|sacrifice another/.test(text),
    dies: /whenever (?:a |another )?(?:nontoken )?(?:creature|artifact) (?:you control )?dies|when (?:this|that) (?:creature|artifact) dies/.test(text),
    etbDamage: /whenever (?:a |another )?creature (?:you control )?enters/.test(text) && /deals? .{0,40}damage/.test(text),
    eachDamage: /deals? .{0,80}damage to each (?:opponent|player)/.test(text),
    ramp: card.roles.includes('ramp') || /add \{[wubrgc]\}|search your library for (?:a |up to \w+ )?basic land/.test(text),
    draw: card.roles.includes('draw') || /draw a card|draw cards|draw two|draw three/.test(text),
    reducer: /cost[s]? \{[^}]+\} less|costs? \{1\} less|cost \{1\} less/.test(text),
    haste: /\bhaste\b/.test(text),
    youWin: /you win the game/.test(text),
    types: creatureTypes(card.typeLine),
    cmc: card.cmc,
  };
}

function unique(cards: StrategySource[]): StrategySource[] {
  const byName = new Map<string, StrategySource>();
  for (const card of cards) {
    const key = card.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || card.oracleText.length > existing.oracleText.length) {
      byName.set(key, { ...card, qty: (existing?.qty ?? 0) + card.qty });
    } else {
      existing.qty += card.qty;
    }
  }
  return [...byName.values()];
}

function sourceOf(card: { name: string; qty?: number; cmc: number; typeLine: string; oracleText: string; keywords: string[]; roles: string[]; colorIdentity?: string[] }): StrategySource {
  return {
    name: card.name,
    qty: card.qty ?? 1,
    cmc: card.cmc,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
    keywords: card.keywords,
    roles: card.roles,
    colors: card.colorIdentity ?? [],
  };
}

function dominantTribe(facts: Fact[], commanders: StrategySource[]): string {
  const counts = new Map<string, number>();
  const commanderTypes = new Set(commanders.flatMap((card) => creatureTypes(card.typeLine)));
  for (const fact of facts) {
    if (fact.land) continue;
    const mentioned = new Set(fact.types);
    for (const type of commanderTypes) {
      if (fact.text.includes(type)) mentioned.add(type);
    }
    for (const type of mentioned) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => {
    const aSpecific = GENERIC_TYPES.has(a[0]) ? 0 : 1;
    const bSpecific = GENERIC_TYPES.has(b[0]) ? 0 : 1;
    return bSpecific - aSpecific || b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  const best = ranked.find((entry) => !GENERIC_TYPES.has(entry[0]) && entry[1] >= 6) ?? ranked.find((entry) => entry[1] >= 8);
  return best?.[0] ?? '';
}

function chooseArchetype(facts: Fact[], commanders: StrategySource[], tribe: string): string {
  const tribeCount = tribe ? facts.filter((fact) => fact.types.includes(tribe) || fact.text.includes(tribe)).length : 0;
  const tokens = facts.filter((fact) => fact.tokens).length;
  const outlets = facts.filter((fact) => fact.outlet).length;
  const deaths = facts.filter((fact) => fact.dies).length;
  const spells = facts.filter((fact) => fact.spell).length;
  const artifacts = facts.filter((fact) => fact.artifact).length;
  const rampArtifacts = facts.filter((fact) => fact.artifact && fact.ramp).length;
  const nonlands = facts.filter((fact) => !fact.land).length || 1;
  const gear = facts.filter((fact) => fact.equipment || fact.aura).length;
  const slug = facts.filter((fact) => fact.eachDamage || fact.etbDamage).length;
  const commanderSlug = commanders.some((card) => /damage to each opponent|damage to each player/.test(card.oracleText.toLowerCase()));
  const commanderTokens = commanders.some((card) => /token/.test(card.oracleText.toLowerCase()));
  const choices: Array<{ label: string; score: number }> = [
    { label: tribe ? `${titleType(tribe)} Tokens` : 'Token Swarm', score: tribe && tribeCount >= 6 && (tokens >= 3 || commanderTokens) ? tribeCount * 2 + tokens * 3 + (commanderTokens ? 12 : 0) : 0 },
    { label: tribe ? pluralType(tribe) : '', score: tribe && tribeCount >= 8 ? tribeCount * 2 : 0 },
    { label: 'Voltron', score: gear >= 6 ? gear * 3 : 0 },
    { label: 'Aristocrats', score: outlets >= 2 && deaths >= 3 ? outlets * 5 + deaths * 2 : 0 },
    { label: 'Spellslinger', score: spells >= 16 ? spells * 2 : 0 },
    { label: 'Artifact Ramp', score: artifacts >= 12 && rampArtifacts >= 3 && artifacts / nonlands >= 0.55 ? artifacts + rampArtifacts * 3 : 0 },
    { label: 'Group Slug', score: slug >= 2 || commanderSlug ? slug * 4 + (commanderSlug ? 28 : 0) : 0 },
    { label: 'Token Swarm', score: tokens >= 6 ? tokens * 3 : 0 },
    { label: 'Midrange Value', score: 1 },
  ];
  choices.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return choices.find((choice) => choice.score > 0 && choice.label)?.label ?? 'Midrange Value';
}

function overviewText(archetype: string, commanders: StrategySource[], facts: Fact[], wins: string[]): string {
  const lead = commanders.length
    ? `${joinList(commanders.map((card) => card.name))} leads this ${archetype.toLowerCase()} deck.`
    : `This ${archetype.toLowerCase()} deck has no commander.`;
  const plan = planSentence(archetype, facts, commanders);
  const ending = wins[0] ? wins[0] : 'It wins by presenting more board than the table can answer.';
  return `${lead} ${plan} ${ending}`;
}

function planSentence(archetype: string, facts: Fact[], commanders: StrategySource[]): string {
  if (archetype.endsWith('Tokens') || archetype === 'Token Swarm') {
    const pings = commanders.some((card) => /damage to each opponent/.test(card.oracleText.toLowerCase()));
    return pings
      ? 'Every new creature is both a body and a ping, so the plan is to make tokens and let them damage the table as they arrive.'
      : 'The plan is to make a crowd of tokens, then use those bodies for attacks and for the cards that care about them.';
  }
  if (archetype === 'Artifact Ramp') return 'The early turns make extra mana with artifacts, then the big artifact payoffs come down ahead of schedule.';
  if (archetype === 'Spellslinger') return 'Most of the deck is instants and sorceries, and the permanents reward you for casting them.';
  if (archetype === 'Aristocrats') return 'Creatures are a resource here: the deck sacrifices them to draw, drain, or make more.';
  if (archetype === 'Voltron') return 'The commander is the threat, and the deck piles equipment and auras onto it.';
  if (archetype === 'Group Slug') return 'Damage hits every opponent at once, so the table loses life while the board develops.';
  if (facts.some((fact) => fact.types.length > 0) && archetype !== 'Midrange Value') {
    return `The deck fills the board with ${archetype.toLowerCase()} and with cards that reward that type.`;
  }
  return 'It plays efficient threats and answers, then tries to win a long game on card quality.';
}

function earlyText(ramp: string[], setup?: string): string {
  if (ramp.length && setup) return `In the first three turns, make mana with ${joinList(ramp)}, and look for ${setup} as the first engine.`;
  if (ramp.length) return `In the first three turns, make mana with ${joinList(ramp)} and keep the land drops coming.`;
  if (setup) return `The opening is lands plus an early setup spell such as ${setup}.`;
  return 'The opening is land drops and the cheapest spells in the deck. There is no dedicated one- or two-mana engine to name.';
}

function midText(names: string[], archetype: string): string {
  if (!names.length) return `The middle turns keep developing the ${archetype.toLowerCase()} plan with whatever permanents are already on the board.`;
  return `The middle of the game is the engine: ${joinList(names)}. These are the cards the rest of the deck is built around.`;
}

function lateText(names: string[], archetype: string): string {
  if (!names.length) return 'The late game is the same engine on a bigger board, not a separate finisher.';
  if (/token|slug/i.test(archetype)) return `If the game goes long, the biggest threats still in the deck are ${joinList(names)}. Most games end on the engine before then.`;
  return `Later, close the game with ${joinList(names)}.`;
}

function synergyLines(facts: Fact[], commanders: StrategySource[], tribe: string, tokens: Fact[], combos: Array<{ a: string; b: string }>): string[] {
  const lines: string[] = [];
  const tokenNames = take(tokens, 2).map((fact) => fact.card.name);
  const commander = commanders[0];
  const commanderText = commanders.map((card) => card.oracleText).join('\n').toLowerCase();
  if (commander && /damage to each opponent|damage to each player/.test(commanderText) && tokenNames.length) {
    lines.push(`${commander.name} + token makers (${joinList(tokenNames)}): each new creature deals damage as it enters.`);
  }
  if (commander && /token/.test(commanderText)) {
    const payoff = facts.find((fact) => !fact.commander && (fact.etbDamage || fact.eachDamage));
    if (payoff) lines.push(`${commander.name} + ${payoff.card.name}: the tokens trigger ${payoff.card.name}.`);
  }
  const clamp = facts.find((fact) => fact.card.name.toLowerCase() === 'skullclamp');
  if (clamp && tokenNames.length) lines.push(`Skullclamp + token makers (${joinList(tokenNames)}): extra creatures become card draw.`);
  const outlet = facts.find((fact) => fact.outlet && !fact.commander);
  const death = facts.find((fact) => fact.dies && fact.card.name !== outlet?.card.name);
  if (outlet && death) lines.push(`${outlet.card.name} + ${death.card.name}: sacrifice a creature to set off the death trigger.`);
  const reducer = facts.find((fact) => fact.reducer);
  const reduced = reducer ? facts.filter((fact) => fact.card.name !== reducer.card.name && !fact.commander && fact.cmc >= 3 && discounts(reducer, fact)).sort(byCurve)[0] : undefined;
  if (reducer && reduced) lines.push(`${reducer.card.name} + ${reduced.card.name}: ${reducer.card.name} makes ${reduced.card.name} cost less.`);
  for (const combo of combos) {
    lines.push(`${combo.a} + ${combo.b}: both halves of this two-card combo are in the deck.`);
  }
  if (commander && tribe && commanderText.includes(tribe)) {
    const mates = take(facts.filter((fact) => !fact.commander && (fact.types.includes(tribe) || fact.text.includes(tribe))).sort(byCurve), 2);
    if (mates.length) lines.push(`${commander.name} + ${joinList(mates.map((fact) => fact.card.name))}: they share the ${tribe} plan the commander is built for.`);
  }
  const haste = facts.find((fact) => fact.haste && !fact.commander && /\{t\}|tap:/.test(commanderText));
  if (commander && haste && /\{t\}|tap:/.test(commanderText)) {
    lines.push(`${haste.card.name} + ${commander.name}: haste lets the commander tap the turn it comes down.`);
  }
  const draw = facts.find((fact) => fact.draw && !fact.commander && fact.card.name.toLowerCase() !== 'skullclamp');
  const engine = facts.find((fact) => !fact.commander && (fact.tokens || fact.reducer || fact.etbDamage) && fact.card.name !== draw?.card.name);
  if (draw && engine && lines.length < 3 && /draw (?:a |two |three )?cards?/.test(draw.text)) {
    lines.push(`${draw.card.name} + ${engine.card.name}: the draw spell restocks the cards you spend on the engine.`);
  }
  return [...new Set(lines)];
}

function winLines(facts: Fact[], commanders: StrategySource[], archetype: string, combos: Array<{ a: string; b: string }>, lateNames: string[]): string[] {
  const lines: string[] = [];
  const commander = commanders[0];
  if (commander && /damage to each opponent/.test(commander.oracleText.toLowerCase())) {
    lines.push(`A wide board with ${commander.name} burns each opponent as creatures enter.`);
  } else if (commander && /token/.test(commander.oracleText.toLowerCase())) {
    lines.push(`${commander.name} makes a token army that attacks for the win.`);
  }
  for (const combo of combos) lines.push(`${combo.a} and ${combo.b} can end the game when both are on the battlefield.`);
  for (const fact of facts.filter((item) => item.youWin)) lines.push(`${fact.card.name} wins the game outright when its condition is met.`);
  if (archetype === 'Artifact Ramp' && lateNames.length) lines.push(`${joinList(lateNames)} are the artifact payoffs that take over once the mana is online.`);
  if (!lines.length && lateNames.length) lines.push(`Attack with ${joinList(lateNames)} once the board is developed.`);
  if (!lines.length) lines.push('The deck wins by attacking with the creatures it spent the game assembling.');
  return lines.slice(0, 4);
}

function mulliganText(ramp: Fact[], engines: Fact[]): string {
  const rock = ramp.find((fact) => fact.cmc <= 2) ?? ramp[0];
  const engine = engines.find((fact) => fact.cmc <= 4);
  const pieces = [rock?.card.name, engine?.card.name].filter((name): name is string => Boolean(name));
  if (!pieces.length) return 'An ideal opening has two or three lands and a spell you can cast on turn two or three. Send back hands that are all expensive spells.';
  return `An ideal opening has two or three lands plus ${joinList(pieces)}. Send back a hand of only expensive spells and no ramp.`;
}

function roleNotes(roles: Array<{ id: string; level: string; count: number }>, facts: Fact[], archetype: string): { strengths: string; weaknesses: string; playAround: string } {
  const level = (id: string) => roles.find((role) => role.id === id)?.level;
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const advice: string[] = [];
  if (level('ramp') === 'high' || level('ramp') === 'ok') strengths.push('Ramp is in good shape, so the deck can deploy its plan on schedule.');
  if (level('removal') === 'ok' || level('removal') === 'high') strengths.push('It has enough removal to answer a creature that would stop the plan.');
  if (level('draw') === 'ok' || level('draw') === 'high') strengths.push('Card draw is healthy enough to find the engine.');
  if (level('wipe') === 'ok' || level('wipe') === 'high') strengths.push('It can clear a board of its own when it needs to.');
  const creatures = facts.filter((fact) => fact.creature || fact.tokens).length;
  const protection = facts.filter((fact) => /creatures you control have indestructible|creatures you control have hexproof/.test(fact.text) || (fact.creature && /\b(?:indestructible|hexproof)\b/.test(fact.text))).length;
  const wide = creatures >= 8 || /token|slug|aristocrat|voltron/i.test(archetype);
  if (wide && protection < 2) {
    weaknesses.push('Weak to board wipes');
    advice.push('Do not play out every token maker into an open sweeper. Keep one engine in hand so a board wipe is not the end of the game.');
  }
  if (level('draw') === 'low') {
    weaknesses.push('Thin on card draw');
    advice.push('Because card draw is thin, cast a draw spell before you commit the rest of the hand.');
  }
  if (level('removal') === 'low') {
    weaknesses.push('Light on removal');
    advice.push('Save the few answers for the permanent that actually stops the plan.');
  }
  if (level('ramp') === 'low') {
    weaknesses.push('Short on ramp');
    advice.push('Mulligan hands that cannot cast a spell on turn two or three.');
  }
  if (!strengths.length) strengths.push('The deck is focused: most of the nonland cards point at the same plan.');
  if (!weaknesses.length) weaknesses.push('No major role gap showed up in the count.');
  if (!advice.length) advice.push('Play the engine first, then spend the extra mana on the payoff.');
  const polished = weaknesses.map((item, index) => index === 0 ? item : `${item.charAt(0).toLowerCase()}${item.slice(1)}`).join('; ');
  return {
    strengths: strengths.join(' '),
    weaknesses: polished.endsWith('.') ? polished : `${polished}.`,
    playAround: advice.join(' '),
  };
}

function bracketText(bracket: StrategyBracket | null, library: StrategySource[]): string {
  if (!bracket) return 'No bracket estimate for this deck.';
  const present = (names: string[]) => names.filter((name) => library.some((card) => card.name.toLowerCase() === name.toLowerCase()));
  const changers = present(bracket.gameChangers);
  const tutors = present(bracket.tutors);
  const fast = present(bracket.fastMana);
  const parts = [`Estimated bracket: ${bracket.label}.`];
  parts.push(changers.length === 1
    ? `1 Game Changer is in the deck: ${changers[0]}.`
    : changers.length
      ? `${changers.length} Game Changers are in the deck, including ${joinList(changers.slice(0, 4))}.`
      : 'No Game Changers are in the deck.');
  if (fast.length) parts.push(`Fast mana includes ${joinList(fast.slice(0, 3))}.`);
  if (tutors.length) parts.push(`Tutors include ${joinList(tutors.slice(0, 3))}.`);
  if (bracket.combos.length) parts.push(`It contains ${bracket.combos.length === 1 ? 'a two-card combo' : 'two-card combos'}.`);
  if (bracket.extraTurns.length) parts.push(`Extra turns: ${joinList(present(bracket.extraTurns).slice(0, 2))}.`);
  if (bracket.massLandDenial.length) parts.push(`Mass land denial: ${joinList(present(bracket.massLandDenial))}.`);
  return parts.join(' ');
}

function discounts(reducer: Fact, target: Fact): boolean {
  const text = reducer.text;
  if (/artifact spells/.test(text) && !target.artifact) return false;
  if (/creature spells/.test(text) && !target.creature) return false;
  if (/red spells|red creature/.test(text) && !(target.card.colors ?? []).includes('R')) return false;
  if (/white spells|white creature/.test(text) && !(target.card.colors ?? []).includes('W')) return false;
  if (/blue spells|blue creature/.test(text) && !(target.card.colors ?? []).includes('U')) return false;
  if (/black spells|black creature/.test(text) && !(target.card.colors ?? []).includes('B')) return false;
  if (/green spells|green creature/.test(text) && !(target.card.colors ?? []).includes('G')) return false;
  return true;
}

function isEngine(fact: Fact, tribe: string, archetype: string): boolean {
  if (fact.tokens || fact.reducer || fact.etbDamage || fact.outlet || fact.youWin) return true;
  if (tribe && (fact.types.includes(tribe) || fact.text.includes(tribe)) && fact.cmc <= 5 && fact.cmc >= 2) return true;
  if (archetype === 'Artifact Ramp' && fact.artifact && fact.cmc >= 3 && fact.cmc <= 6) return true;
  if (archetype === 'Spellslinger' && fact.spell && fact.cmc <= 4) return true;
  return false;
}

function matchesPlan(fact: Fact, archetype: string, tribe: string): boolean {
  if (archetype === 'Artifact Ramp') return fact.artifact || fact.youWin;
  if (archetype.endsWith('Tokens') || archetype === 'Token Swarm') return fact.tokens || fact.creature || (tribe ? fact.types.includes(tribe) : false);
  if (archetype === 'Group Slug') return fact.eachDamage || fact.etbDamage || fact.creature;
  if (archetype === 'Aristocrats') return fact.outlet || fact.dies || fact.creature;
  if (archetype === 'Voltron') return fact.equipment || fact.aura || fact.creature;
  if (archetype === 'Spellslinger') return fact.spell || fact.creature;
  return fact.creature || fact.youWin;
}

function take(facts: Fact[], count: number): Fact[] {
  return facts.slice(0, count);
}

function byCurve(a: Fact, b: Fact): number {
  return a.cmc - b.cmc || a.card.name.localeCompare(b.card.name);
}

function byEngine(a: Fact, b: Fact): number {
  const rank = (fact: Fact) => (fact.tokens || fact.etbDamage ? 0 : fact.reducer || fact.outlet ? 1 : 2);
  return rank(a) - rank(b) || byCurve(a, b);
}

function byFinisher(a: Fact, b: Fact): number {
  const rank = (fact: Fact) => (fact.youWin ? 0 : fact.eachDamage || fact.etbDamage || fact.tokens ? 1 : 2);
  return rank(a) - rank(b) || b.cmc - a.cmc || a.card.name.localeCompare(b.card.name);
}

function creatureTypes(typeLine: string): string[] {
  const face = typeLine.split('//')[0] ?? typeLine;
  const side = face.split(/—|–/)[1] ?? '';
  return side.toLowerCase().split(/[^a-z]+/).filter((type) => type.length > 2 && type !== 'legendary');
}

function titleType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function pluralType(type: string): string {
  if (type === 'elf') return 'Elves';
  const titled = titleType(type);
  if (titled.endsWith('s')) return titled;
  if (/[^aeiou]y$/i.test(titled)) return `${titled.slice(0, -1)}ies`;
  return `${titled}s`;
}

function joinList(names: string[]): string {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (uniqueNames.length === 0) return '';
  if (uniqueNames.length === 1) return uniqueNames[0];
  if (uniqueNames.length === 2) return `${uniqueNames[0]} and ${uniqueNames[1]}`;
  return `${uniqueNames.slice(0, -1).join(', ')}, and ${uniqueNames[uniqueNames.length - 1]}`;
}
