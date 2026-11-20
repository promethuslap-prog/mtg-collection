import { describe, expect, it } from 'vitest';
import { buildDeck, canBeCommander, rankOwnedCommanders, suggestColors, swapBuiltCard, type PoolCard } from './deckBuild';
import { reviewCards } from './brackets';

function card(partial: Partial<PoolCard> & { name: string }): PoolCard {
  const typeLine = partial.typeLine ?? 'Creature — Goblin';
  return {
    name: partial.name,
    set: partial.set ?? 'x',
    collectorNumber: partial.collectorNumber ?? '1',
    qty: partial.qty ?? 1,
    cmc: partial.cmc ?? 2,
    manaCost: partial.manaCost ?? '{1}{R}',
    typeLine,
    colorIdentity: partial.colorIdentity ?? ['R'],
    oracleText: partial.oracleText ?? '',
    keywords: partial.keywords ?? [],
    legalities: partial.legalities ?? { commander: 'legal', standard: 'legal', modern: 'legal', pioneer: 'legal' },
    edhrecRank: partial.edhrecRank ?? 1500,
    image: '',
    producedMana: partial.producedMana ?? [],
    roles: partial.roles ?? [],
    oracleId: partial.oracleId ?? partial.name,
    scryfallUri: '',
    owned: partial.owned ?? true,
    inDecks: partial.inDecks ?? [],
    gameChanger: partial.gameChanger,
    massLandDenial: partial.massLandDenial,
    extraTurn: partial.extraTurn,
    tutor: partial.tutor,
    fastMana: partial.fastMana,
  };
}

function redPool(): PoolCard[] {
  const spells = Array.from({ length: 40 }, (_, index) => card({
    name: `Goblin ${index}`,
    cmc: (index % 5) + 1,
    manaCost: '{R}',
    oracleText: index % 7 === 0 ? '{T}: Add {R}.' : index % 7 === 1 ? 'Draw a card.' : index % 7 === 2 ? 'Destroy target creature.' : index % 11 === 0 ? 'Destroy all creatures.' : 'Goblin token.',
    roles: index % 7 === 0 ? ['ramp'] : index % 7 === 1 ? ['draw'] : index % 7 === 2 ? ['removal'] : index % 11 === 0 ? ['wipe'] : [],
  }));
  return [
    card({ name: 'Krenko, Mob Boss', typeLine: 'Legendary Creature — Goblin Warrior', oracleText: 'Tap: create Goblin tokens.', cmc: 4, manaCost: '{2}{R}{R}' }),
    card({ name: 'Mountain', typeLine: 'Basic Land — Mountain', colorIdentity: ['R'], producedMana: ['R'], roles: ['land'], qty: 2, cmc: 0, manaCost: '' }),
    card({ name: 'Command Tower', typeLine: 'Land', colorIdentity: [], producedMana: ['R'], roles: ['land'], cmc: 0, manaCost: '' }),
    card({ name: 'Lightning Bolt', typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.', roles: ['removal'], qty: 4, cmc: 1, manaCost: '{R}' }),
    card({ name: 'Counterspell', typeLine: 'Instant', colorIdentity: ['U'], oracleText: 'Counter target spell.', manaCost: '{U}{U}', legalities: { commander: 'legal' } }),
    card({ name: 'Emrakul, the Aeons Torn', typeLine: 'Legendary Creature — Eldrazi', colorIdentity: [], oracleText: 'Flying.', legalities: { commander: 'banned' }, cmc: 15, manaCost: '{15}' }),
    ...spells,
  ];
}

describe('deck builder', () => {
  it('recognizes legal commanders and skips banned legends', () => {
    const pool = redPool();
    expect(canBeCommander(pool[0])).toBe(true);
    expect(canBeCommander(pool.find((card) => card.name.startsWith('Emrakul'))!)).toBe(false);
    const ranked = rankOwnedCommanders(pool);
    expect(ranked[0]?.card.name).toBe('Krenko, Mob Boss');
    expect(ranked[0]?.playable).toBeGreaterThan(10);
    expect(ranked.some((item) => item.card.name.startsWith('Emrakul'))).toBe(false);
  });

  it('builds a 99-card singleton Commander deck from owned cards', () => {
    const built = buildDeck(redPool(), {
      format: 'commander',
      commander: redPool()[0],
      colors: ['R'],
      theme: 'goblins',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 3,
    });
    const slots = built.cards.reduce((sum, card) => sum + card.qty, 0);
    expect(slots).toBe(99);
    expect(built.summary).toMatch(/99 of 99 from your collection/);
    const names = built.cards.map((card) => card.card.name);
    expect(new Set(names.filter((name) => name !== 'Mountain')).size).toBe(names.filter((name) => name !== 'Mountain').length);
    expect(built.cards.find((card) => card.card.name === 'Lightning Bolt')?.qty).toBe(1);
    expect(names).not.toContain('Counterspell');
    expect(names).not.toContain('Emrakul, the Aeons Torn');
    expect(names).not.toContain('Krenko, Mob Boss');
    const mountains = built.cards.find((card) => card.card.name === 'Mountain');
    expect(mountains?.qty).toBeGreaterThan(2);
    expect(built.cards.every((card) => card.reason.length > 12)).toBe(true);
    expect(built.roles.find((role) => role.id === 'ramp')?.count).toBeGreaterThan(0);
  });

  it('is deterministic and changes near-ties when the seed changes', () => {
    const request = {
      format: 'commander' as const,
      commander: redPool()[0],
      colors: ['R'],
      theme: '',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 1,
    };
    const first = buildDeck(redPool(), request).cards.map((card) => `${card.qty} ${card.card.name}`).join('|');
    const again = buildDeck(redPool(), request).cards.map((card) => `${card.qty} ${card.card.name}`).join('|');
    const other = buildDeck(redPool(), { ...request, seed: 9 }).cards.map((card) => `${card.qty} ${card.card.name}`).join('|');
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it('suggests the deepest color and can add a limited buy list', () => {
    const pool = [
      ...redPool(),
      card({ name: 'Island', typeLine: 'Basic Land — Island', colorIdentity: ['U'], producedMana: ['U'], roles: ['land'], manaCost: '', cmc: 0 }),
      card({ name: 'Opt', typeLine: 'Instant', colorIdentity: ['U'], manaCost: '{U}', oracleText: 'Draw a card.', roles: ['draw'] }),
    ];
    expect(suggestColors(pool, 'casual', '', 1).colors).toEqual(['R']);
    const extra = card({ name: 'Dockside Extortionist', oracleText: 'create Treasure tokens. Add {R}.', roles: ['ramp'], owned: false, edhrecRank: 20 });
    const built = buildDeck(pool, {
      format: 'commander',
      commander: pool[0],
      colors: ['R'],
      theme: '',
      onlyOwned: false,
      buyLimit: 1,
      allowInOtherDecks: true,
      seed: 2,
      extras: [extra],
    });
    expect(built.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(99);
    expect(built.toBuy.map((card) => card.card.name)).toContain('Dockside Extortionist');
    expect(built.fromCollection).toBe(98);
  });

  it('builds a 60-card deck with at most four copies', () => {
    const built = buildDeck(redPool(), {
      format: 'modern',
      commander: null,
      colors: ['R'],
      theme: '',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: false,
      seed: 4,
    });
    expect(built.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(60);
    for (const card of built.cards) {
      if (card.card.name !== 'Mountain') expect(card.qty).toBeLessThanOrEqual(4);
    }
  });

  it('swaps a spell for another owned card and keeps the size', () => {
    const pool = [
      ...redPool(),
      ...Array.from({ length: 40 }, (_, index) => card({ name: `Bench ${index}`, cmc: 6, oracleText: 'A spare goblin.', manaCost: '{5}{R}' })),
    ];
    const request = {
      format: 'commander' as const,
      commander: pool[0],
      colors: ['R'],
      theme: 'goblins',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 5,
    };
    const built = buildDeck(pool, request);
    const spell = built.cards.find((card) => !card.card.typeLine.includes('Land') && card.card.name !== 'Mountain');
    expect(spell).toBeTruthy();
    const swapped = swapBuiltCard(built, spell!.card.name, pool, request);
    expect(swapped.cards.reduce((sum, card) => sum + card.qty, 0)).toBe(99);
    expect(swapped.cards.some((card) => card.card.name === spell!.card.name)).toBe(false);
  });

  it('keeps Game Changers out of Bracket 2 and allows them in Bracket 4', () => {
    const ring = card({
      name: 'The One Ring',
      colorIdentity: [],
      manaCost: '{4}',
      cmc: 4,
      typeLine: 'Legendary Artifact',
      oracleText: 'Indestructible. Draw a card.',
      roles: ['draw'],
      gameChanger: true,
      edhrecRank: 10,
    });
    const kiki = card({ name: 'Kiki-Jiki, Mirror Breaker', typeLine: 'Legendary Creature — Goblin Shaman', oracleText: 'Create a token copy.' });
    const conscripts = card({ name: 'Zealous Conscripts', typeLine: 'Creature — Human Warrior', oracleText: 'Gain control of target permanent.' });
    const pool = [...redPool(), ring, kiki, conscripts];
    const base = {
      format: 'commander' as const,
      commander: redPool()[0],
      colors: ['R'],
      theme: 'goblins',
      onlyOwned: true,
      buyLimit: 0,
      allowInOtherDecks: true,
      seed: 1,
    };
    const core = buildDeck(pool, { ...base, bracket: 2 });
    const optimized = buildDeck(pool, { ...base, bracket: 4 });
    expect(core.cards.some((item) => item.card.name === 'The One Ring')).toBe(false);
    expect(core.check?.gameChangers).toEqual([]);
    expect(core.skipped?.some((item) => item.name === 'The One Ring' && item.reason === 'Game Changer')).toBe(true);
    expect(optimized.cards.some((item) => item.card.name === 'The One Ring')).toBe(true);
    const comboNames = core.cards.map((item) => item.card.name);
    expect(comboNames.includes('Kiki-Jiki, Mirror Breaker') && comboNames.includes('Zealous Conscripts')).toBe(false);
    const review = reviewCards([
      { name: 'The One Ring', typeLine: 'Legendary Artifact', oracleText: '', cmc: 4, gameChanger: true },
      { name: 'Mana Vault', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}{C}.', cmc: 1, gameChanger: true },
      { name: 'Demonic Tutor', typeLine: 'Sorcery', oracleText: 'Search your library for a card.', cmc: 2, gameChanger: true },
      { name: 'Gamble', typeLine: 'Sorcery', oracleText: 'Search your library for a card.', cmc: 1, gameChanger: true },
    ], new Set());
    expect(review.estimated).toBe(4);
  });
});
