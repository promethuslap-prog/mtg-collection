import { describe, expect, it } from 'vitest';
import { describeDeck, sameStrategy, strategyBlurb, strategyComments, type StrategySource } from './strategy';

function card(partial: Partial<StrategySource> & { name: string }): StrategySource {
  return {
    name: partial.name,
    qty: partial.qty ?? 1,
    cmc: partial.cmc ?? 2,
    typeLine: partial.typeLine ?? 'Creature — Goblin',
    oracleText: partial.oracleText ?? '',
    keywords: partial.keywords ?? [],
    roles: partial.roles ?? [],
  };
}

describe('deck strategy', () => {
  it('describes a goblin token deck from the cards it actually contains', () => {
    const krenko = card({
      name: 'Krenko, Mob Boss',
      cmc: 4,
      typeLine: 'Legendary Creature — Goblin Warrior',
      oracleText: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    });
    const deck = describeDeck({
      commanders: [krenko],
      cards: [
        krenko,
        card({ name: 'Sol Ring', cmc: 1, typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.', roles: ['ramp'] }),
        card({ name: 'Skullclamp', cmc: 1, typeLine: 'Artifact — Equipment', oracleText: 'Equipped creature gets +1/-1. Whenever equipped creature dies, draw two cards.' }),
        card({ name: 'Goblin Instigator', cmc: 2, typeLine: 'Creature — Goblin', oracleText: 'When this creature enters, create a 1/1 red Goblin creature token.' }),
        card({ name: 'Krenko\'s Command', cmc: 2, typeLine: 'Sorcery', oracleText: 'Create two 1/1 red Goblin creature tokens.' }),
        card({ name: 'Legion Warboss', cmc: 3, typeLine: 'Creature — Goblin', oracleText: 'At the beginning of combat, create a 1/1 red Goblin creature token.' }),
        card({ name: 'Siege-Gang Commander', cmc: 5, typeLine: 'Creature — Goblin', oracleText: 'When this creature enters, create three 1/1 red Goblin creature tokens.' }),
        card({ name: 'Mountain', cmc: 0, typeLine: 'Basic Land — Mountain', oracleText: '{T}: Add {R}.', roles: ['land'] }),
        ...Array.from({ length: 6 }, (_, index) => card({ name: `Goblin ${index}`, typeLine: 'Creature — Goblin', oracleText: 'Goblin token.' })),
      ],
      roles: [
        { id: 'land', label: 'Lands', level: 'ok', count: 36 },
        { id: 'ramp', label: 'Ramp', level: 'ok', count: 10 },
        { id: 'draw', label: 'Draw', level: 'low', count: 4 },
        { id: 'removal', label: 'Removal', level: 'ok', count: 8 },
        { id: 'wipe', label: 'Wipes', level: 'low', count: 0 },
      ],
    });
    expect(deck.archetype).toBe('Goblin Tokens');
    expect(deck.overview).toContain('Krenko, Mob Boss');
    expect(deck.early).toContain('Sol Ring');
    expect(deck.synergies.join(' ')).toContain('Skullclamp');
    expect(deck.weaknesses.toLowerCase()).toContain('thin on card draw');
    expect(deck.weaknesses.toLowerCase()).toContain('board wipes');
    expect(`${deck.overview} ${deck.early} ${deck.mid} ${deck.late} ${deck.synergies.join(' ')} ${deck.wins.join(' ')}`).not.toContain('Black Lotus');
    expect(sameStrategy(deck, describeDeck({
      commanders: [krenko],
      cards: [
        krenko,
        card({ name: 'Sol Ring', cmc: 1, typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.', roles: ['ramp'] }),
        card({ name: 'Skullclamp', cmc: 1, typeLine: 'Artifact — Equipment', oracleText: 'Equipped creature gets +1/-1. Whenever equipped creature dies, draw two cards.' }),
        card({ name: 'Goblin Instigator', cmc: 2, typeLine: 'Creature — Goblin', oracleText: 'When this creature enters, create a 1/1 red Goblin creature token.' }),
        card({ name: 'Krenko\'s Command', cmc: 2, typeLine: 'Sorcery', oracleText: 'Create two 1/1 red Goblin creature tokens.' }),
        card({ name: 'Legion Warboss', cmc: 3, typeLine: 'Creature — Goblin', oracleText: 'At the beginning of combat, create a 1/1 red Goblin creature token.' }),
        card({ name: 'Siege-Gang Commander', cmc: 5, typeLine: 'Creature — Goblin', oracleText: 'When this creature enters, create three 1/1 red Goblin creature tokens.' }),
        card({ name: 'Mountain', cmc: 0, typeLine: 'Basic Land — Mountain', oracleText: '{T}: Add {R}.', roles: ['land'] }),
        ...Array.from({ length: 6 }, (_, index) => card({ name: `Goblin ${index}`, typeLine: 'Creature — Goblin', oracleText: 'Goblin token.' })),
      ],
      roles: [
        { id: 'land', label: 'Lands', level: 'ok', count: 36 },
        { id: 'ramp', label: 'Ramp', level: 'ok', count: 10 },
        { id: 'draw', label: 'Draw', level: 'low', count: 4 },
        { id: 'removal', label: 'Removal', level: 'ok', count: 8 },
        { id: 'wipe', label: 'Wipes', level: 'low', count: 0 },
      ],
    }))).toBe(true);
    expect(strategyBlurb(deck)).toMatch(/^Goblin Tokens\. /);
    expect(strategyComments(deck)).toContain('// Goblin Tokens');
    expect(strategyComments({ ...deck, notes: 'Edited plan.' })).toContain('// Edited plan.');
  });

  it('calls an artifact pile Artifact Ramp and does not invent a commander', () => {
    const artifacts = ['Sol Ring', 'Basalt Monolith', 'Thran Dynamo', 'Etherium Sculptor', 'Darksteel Forge', 'Forsaken Monument', 'Myr Battlesphere'].map((name, index) => card({
      name,
      cmc: index + 1,
      typeLine: name === 'Etherium Sculptor' ? 'Artifact Creature — Vedalken Artificer' : 'Artifact',
      oracleText: name === 'Etherium Sculptor'
        ? 'Artifact spells you cast cost {1} less to cast.'
        : name === 'Darksteel Forge'
          ? 'Artifacts you control have indestructible.'
          : '{T}: Add {C}{C}.',
      roles: name === 'Etherium Sculptor' || name === 'Darksteel Forge' ? [] : ['ramp'],
    }));
    const deck = describeDeck({
      commanders: [],
      cards: [
        ...artifacts,
        ...Array.from({ length: 8 }, (_, index) => card({ name: `Rock ${index}`, typeLine: 'Artifact', oracleText: '{T}: Add {C}.', roles: ['ramp'], cmc: 2 })),
      ],
    });
    expect(deck.archetype).toBe('Artifact Ramp');
    expect(deck.overview.toLowerCase()).toContain('no commander');
    expect(deck.overview).not.toMatch(/Krenko|Goblin/);
  });
});
