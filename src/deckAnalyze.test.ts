import { describe, expect, it } from 'vitest';
import { analyzeDeck, combinedIdentity, inferRoles, landRecommendation } from './deckAnalyze';
import type { DeckRecord } from './deckModel';
import type { KnownCard } from './deckAnalyze';

function card(partial: Partial<KnownCard>): KnownCard {
  return {
    name: partial.name ?? 'Card',
    set: 'x',
    collectorNumber: '1',
    qty: partial.qty ?? 1,
    cmc: partial.cmc ?? 2,
    manaCost: partial.manaCost ?? '{1}{B}',
    typeLine: partial.typeLine ?? 'Instant',
    colorIdentity: partial.colorIdentity ?? ['B'],
    oracleText: partial.oracleText ?? '',
    keywords: partial.keywords ?? [],
    legality: partial.legality ?? 'legal',
    edhrecRank: partial.edhrecRank ?? 1000,
    priceUsd: partial.priceUsd ?? 1,
    image: '',
    producedMana: partial.producedMana ?? [],
    roles: partial.roles ?? inferRoles(partial.typeLine ?? 'Instant', partial.oracleText ?? ''),
  };
}

const deck: DeckRecord = {
  id: 'jadar',
  name: 'Jadar',
  format: 'commander',
  commanders: ['Jadar, Ghoulcaller of Nephalia'],
  url: '',
  mainboard: [],
  sideboard: [],
};

describe('deck analysis', () => {
  it('combines partner color identities', () => {
    expect(combinedIdentity([['R'], ['W', 'U']])).toEqual(['W', 'U', 'R']);
  });

  it('recommends more lands for a higher curve', () => {
    expect(landRecommendation('commander', 3.8, 6)).toBeGreaterThan(landRecommendation('commander', 2.4, 12));
  });

  it('flags off-identity cards and builds owned adds', () => {
    const cards = [
      card({ name: 'Jadar, Ghoulcaller of Nephalia', typeLine: 'Legendary Creature — Human Wizard', colorIdentity: ['B'], cmc: 2 }),
      card({ name: 'Swamp', typeLine: 'Basic Land — Swamp', colorIdentity: ['B'], roles: ['land'], producedMana: ['B'], qty: 20, cmc: 0, manaCost: '' }),
      card({ name: 'Lightning Bolt', typeLine: 'Instant', colorIdentity: ['R'], oracleText: 'Lightning Bolt deals 3 damage to any target.' }),
    ];
    const owned = [
      card({ name: 'Arcane Signet', typeLine: 'Artifact', colorIdentity: [], oracleText: '{T}: Add one mana of any color in your commander\'s color identity.', edhrecRank: 2 }),
      card({ name: 'Night\'s Whisper', typeLine: 'Sorcery', colorIdentity: ['B'], oracleText: 'You draw two cards and you lose 2 life.', edhrecRank: 80 }),
      card({ name: 'Go for the Throat', typeLine: 'Instant', colorIdentity: ['B'], oracleText: 'Destroy target nonartifact creature.', edhrecRank: 40 }),
    ];
    const report = analyzeDeck({
      deck,
      cards,
      identity: ['B'],
      owned,
      otherDecks: [{ id: 'other', name: 'black plague', names: ['Arcane Signet'] }],
      upgrades: [],
      budget: 5,
    });
    expect(report.issues.some((issue) => issue.includes('Lightning Bolt'))).toBe(true);
    expect(report.adds.length).toBeGreaterThanOrEqual(3);
    expect(report.adds[0].reason.length).toBeGreaterThan(10);
    expect(report.adds.find((item) => item.name === 'Arcane Signet')?.decks).toEqual(['black plague']);
    expect(report.needed).toBe(78);
    expect(report.fill.length).toBeGreaterThan(0);
  });
});
