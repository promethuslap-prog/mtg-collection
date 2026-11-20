import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '../src/cards';
import { loadGameChangers } from '../src/brackets';
import { buildDeck, findBestCommanders, rankOwnedCommanders, suggestColors, type PoolCard } from '../src/deckBuild';
import { inferRoles } from '../src/deckAnalyze';
import { parseMoxfieldFile } from '../src/moxfield';
import { fetchCollection } from '../src/scryfall';
import { normalizeName } from '../src/text';

const live = process.env.DECK_BUILD_LIVE === '1';

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

describe.skipIf(!live)('live collection build', () => {
  it('builds Krenko, Sheoldred, and a suggested deck from moxfield.json', async () => {
    const file = parseMoxfieldFile(JSON.parse(readFileSync(new URL('../public/moxfield.json', import.meta.url), 'utf8')));
    expect(file).toBeTruthy();
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
    const ranked = rankOwnedCommanders(pool);
    const krenko = pool.find((card) => card.name === 'Krenko, Mob Boss');
    expect(krenko).toBeTruthy();
    const krenkoDeck = buildDeck(pool, {
      format: 'commander',
      commander: krenko!,
      colors: krenko!.colorIdentity,
      theme: 'goblins',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 1,
    });
    expect(krenkoDeck.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(99);
    expect(new Set(krenkoDeck.cards.filter((card) => !/basic/i.test(card.card.typeLine)).map((card) => card.card.name)).size)
      .toBe(krenkoDeck.cards.filter((card) => !/basic/i.test(card.card.typeLine)).length);
    expect(krenkoDeck.cards.every((card) => card.card.colorIdentity.every((color) => krenko!.colorIdentity.includes(color)) || /basic/i.test(card.card.typeLine))).toBe(true);

    const sheoldredCards = await fetchCollection([{ name: 'Sheoldred, the Apocalypse' }]);
    const sheoldred = toPool(sheoldredCards.cards[0], 0);
    sheoldred.owned = false;
    const sheoldredDeck = buildDeck(pool, {
      format: 'commander',
      commander: sheoldred,
      colors: sheoldred.colorIdentity,
      theme: '',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 2,
    });
    expect(sheoldredDeck.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(99);
    expect(sheoldredDeck.cards.every((card) => card.card.colorIdentity.every((color) => sheoldred.colorIdentity.includes(color)))).toBe(true);

    const suggested = suggestColors(pool, 'casual', '', 1);
    const casual = buildDeck(pool, {
      format: 'casual',
      commander: null,
      colors: suggested.colors,
      theme: '',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 3,
    });
    expect(casual.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(60);

    const gameChangers = await loadGameChangers();
    const shared = {
      format: 'commander' as const,
      commander: krenko!,
      colors: krenko!.colorIdentity,
      theme: 'goblins',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 1,
      gameChangers,
    };
    const core = buildDeck(pool, { ...shared, bracket: 2 });
    const optimized = buildDeck(pool, { ...shared, bracket: 4 });
    expect(core.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(99);
    expect(optimized.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(99);
    expect(core.check?.gameChangers).toEqual([]);
    const names = (deck: { cards: Array<{ card: { name: string } }> }) => new Set(deck.cards.map((card) => card.card.name));
    const coreNames = names(core);
    const optimizedNames = names(optimized);
    const onlyOptimized = [...optimizedNames].filter((name) => !coreNames.has(name));
    const onlyCore = [...coreNames].filter((name) => !optimizedNames.has(name));

    const started = performance.now();
    const best = findBestCommanders(pool, { seed: 1, bracket: 'any', gameChangers, limit: 15 });
    const anyMs = Math.round(performance.now() - started);
    const bracketStarted = performance.now();
    const coreBest = findBestCommanders(pool, { seed: 1, bracket: 2, gameChangers, limit: 15 });
    const coreMs = Math.round(performance.now() - bracketStarted);
    const brief = (pick: NonNullable<typeof best>['winner']) => ({
      names: pick.faces.map((face) => face.name),
      colors: pick.colors,
      score: pick.power.score,
      why: pick.power.why,
      weakness: pick.power.weakness,
      summary: pick.deck.summary,
      roles: pick.deck.roles.map((role) => ({ id: role.id, count: role.count, level: role.level, min: role.min, aim: role.aim })),
      gameChangers: pick.deck.check?.gameChangers,
    });

    writeFileSync('/tmp/build-report.json', JSON.stringify({
      best: best ? { ms: anyMs, considered: best.considered, tried: best.tried, winner: brief(best.winner), leaderboard: best.leaderboard.map(brief) } : null,
      bracket2: coreBest ? { ms: coreMs, winner: brief(coreBest.winner), leaderboard: coreBest.leaderboard.map(brief) } : null,
      brackets: {
        core: { summary: core.summary, gameChangers: core.check?.gameChangers, skipped: core.skipped, tutors: core.check?.tutors, fastMana: core.check?.fastMana },
        optimized: { summary: optimized.summary, gameChangers: optimized.check?.gameChangers, tutors: optimized.check?.tutors, fastMana: optimized.check?.fastMana },
        onlyOptimized,
        onlyCore,
      },
      ranked: ranked.slice(0, 8).map((item) => ({ name: item.card.name, playable: item.playable, synergy: item.synergy })),
      krenkoRank: ranked.findIndex((item) => item.card.name === 'Krenko, Mob Boss'),
      krenko: { summary: krenkoDeck.summary, roles: krenkoDeck.roles.map((role) => ({ id: role.id, count: role.count, level: role.level })) },
      sheoldred: { summary: sheoldredDeck.summary, roles: sheoldredDeck.roles.map((role) => ({ id: role.id, count: role.count, level: role.level })) },
      suggested: { colors: suggested.colors, summary: casual.summary },
    }, null, 2));
  }, 180000);
});
