import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '../src/cards';
import { loadGameChangers, reviewCards } from '../src/brackets';
import { buildDeck, findBestCommanders, type PoolCard } from '../src/deckBuild';
import { inferRoles } from '../src/deckAnalyze';
import { parseDeckFile } from '../src/deckModel';
import { parseMoxfieldFile } from '../src/moxfield';
import { fetchCollection } from '../src/scryfall';
import { describeBuilt, describeDeck, type StrategySource } from '../src/strategy';
import { normalizeName } from '../src/text';

const live = process.env.STRATEGY_LIVE === '1';

function toPool(card: ScryfallCard, qty: number): PoolCard {
  const oracle = card.oracle_text ?? card.card_faces?.map((face) => face.oracle_text).filter(Boolean).join('\n') ?? '';
  const typeLine = card.type_line ?? card.card_faces?.map((face) => face.type_line).filter(Boolean).join(' // ') ?? '';
  return {
    name: card.name,
    set: card.set,
    collectorNumber: card.collector_number,
    qty,
    cmc: card.cmc ?? 0,
    manaCost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? '',
    typeLine,
    colorIdentity: card.color_identity ?? [],
    oracleText: oracle,
    keywords: card.keywords ?? [],
    legalities: card.legalities ?? {},
    edhrecRank: card.edhrec_rank ?? null,
    image: '',
    producedMana: card.produced_mana ?? [],
    roles: inferRoles(typeLine, oracle),
    oracleId: card.oracle_id ?? '',
    scryfallUri: card.scryfall_uri ?? '',
    owned: true,
    inDecks: [],
  };
}

describe.skipIf(!live)('live strategy', () => {
  it('writes Purphoros, Krenko, and the artifact deck descriptions', async () => {
    const file = parseMoxfieldFile(JSON.parse(readFileSync(new URL('../public/moxfield.json', import.meta.url), 'utf8')));
    const lines = file!.cards;
    const first = await fetchCollection(lines.map((card) => ({ set: card.set, collector_number: card.collectorNumber })));
    const found = new Map(first.cards.map((card) => [normalizeName(card.name), card]));
    const missing = lines.filter((card) => !found.has(normalizeName(card.name)));
    if (missing.length) {
      const second = await fetchCollection(missing.map((card) => ({ name: card.name })));
      for (const card of second.cards) found.set(normalizeName(card.name), card);
    }
    const qty = new Map<string, number>();
    for (const line of lines) qty.set(normalizeName(line.name), (qty.get(normalizeName(line.name)) ?? 0) + line.qty);
    const pool = [...found.values()].map((card) => toPool(card, qty.get(normalizeName(card.name)) ?? 1));
    const gameChangers = await loadGameChangers();
    const best = findBestCommanders(pool, { seed: 1, bracket: 'any', gameChangers, limit: 15 });
    expect(best?.winner.faces[0].name).toBe('Purphoros, God of the Forge');
    const purphoros = describeBuilt(best!.winner.deck);
    const named = new Set([
      ...best!.winner.deck.cards.map((card) => card.card.name),
      best!.winner.deck.commander?.name,
    ].filter(Boolean));
    const mentioned = [...`${purphoros.overview} ${purphoros.early} ${purphoros.mid} ${purphoros.late} ${purphoros.synergies.join(' ')} ${purphoros.wins.join(' ')}`.matchAll(/[A-Z][^.:]{2,}/g)].map((match) => match[0]);
    for (const phrase of purphoros.synergies) expect(named.has(phrase.split(' + ')[0]) || phrase.includes('token')).toBe(true);

    const krenkoCard = pool.find((card) => card.name === 'Krenko, Mob Boss');
    const krenkoDeck = buildDeck(pool, {
      format: 'commander',
      commander: krenkoCard!,
      colors: krenkoCard!.colorIdentity,
      theme: 'goblins',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 1,
      bracket: 'any',
      gameChangers,
    });
    const krenko = describeBuilt(krenkoDeck);

    const decks = parseDeckFile(JSON.parse(readFileSync(new URL('../public/decks.json', import.meta.url), 'utf8')));
    const artifact = decks!.decks.find((deck) => deck.name === 'kitchen Table Artifact Deck');
    expect(artifact).toBeTruthy();
    const fetched = await fetchCollection(artifact!.mainboard.map((card) => ({ set: card.set, collector_number: card.collectorNumber })));
    const byName = new Map(fetched.cards.map((card) => [normalizeName(card.name), card]));
    const still = artifact!.mainboard.filter((card) => !byName.has(normalizeName(card.name)));
    if (still.length) {
      const second = await fetchCollection(still.map((card) => ({ name: card.name })));
      for (const card of second.cards) byName.set(normalizeName(card.name), card);
    }
    const sources: StrategySource[] = artifact!.mainboard.map((line) => {
      const card = byName.get(normalizeName(line.name));
      const oracle = card?.oracle_text ?? '';
      const typeLine = card?.type_line ?? '';
      return {
        name: card?.name ?? line.name,
        qty: line.qty,
        cmc: card?.cmc ?? 0,
        typeLine,
        oracleText: oracle,
        keywords: card?.keywords ?? [],
        roles: inferRoles(typeLine, oracle),
      };
    });
    const review = reviewCards(sources.map((card) => ({ name: card.name, typeLine: card.typeLine, oracleText: card.oracleText, cmc: card.cmc })), gameChangers);
    const artifacts = describeDeck({
      commanders: [],
      cards: sources,
      bracket: {
        label: review.label,
        estimated: review.estimated,
        gameChangers: review.gameChangers,
        tutors: review.tutors,
        fastMana: review.fastMana,
        extraTurns: review.extraTurns,
        massLandDenial: review.massLandDenial,
        combos: review.combos,
      },
    });
    writeFileSync('/tmp/strategy-report.json', JSON.stringify({ purphoros, krenko: { archetype: krenko.archetype, overview: krenko.overview, early: krenko.early, synergies: krenko.synergies, wins: krenko.wins }, artifacts, mentioned }, null, 2));
    expect(purphoros.overview.split(/[.!?]/).filter((part) => part.trim()).length).toBeGreaterThanOrEqual(2);
    expect(krenko.archetype.toLowerCase()).toContain('goblin');
    expect(artifacts.archetype).toBe('Artifact Ramp');
    expect(artifacts.overview.toLowerCase()).not.toContain('krenko');
  }, 180000);
});
