import { describe, expect, it } from 'vitest';
import { filterEntries, mergeIntoCollection, sortEntries, summarize, unitPrice } from './collection';
import { EMPTY_FILTERS, type CollectionEntry } from './types';

function entry(overrides: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    id: 'bolt:nonfoil',
    scryfallId: 'bolt',
    oracleId: 'oracle-bolt',
    name: 'Lightning Bolt',
    set: 'mh2',
    setName: 'Modern Horizons 2',
    collectorNumber: '371',
    rarity: 'uncommon',
    colorIdentity: ['R'],
    typeLine: 'Instant',
    image: '',
    priceUsd: 1.5,
    priceUsdFoil: 2.25,
    priceUsdEtched: null,
    finish: 'nonfoil',
    quantity: 4,
    addedAt: 10,
    scryfallUri: '',
    ...overrides,
  };
}

describe('collection math', () => {
  const bolt = entry();
  const foil = entry({
    id: 'bolt:foil',
    finish: 'foil',
    quantity: 1,
    addedAt: 20,
  });
  const ring = entry({
    id: 'ring:nonfoil',
    scryfallId: 'ring',
    oracleId: 'oracle-ring',
    name: 'Sol Ring',
    set: 'c21',
    setName: 'Commander 2021',
    collectorNumber: '263',
    rarity: 'uncommon',
    colorIdentity: [],
    typeLine: 'Artifact',
    priceUsd: 1,
    priceUsdFoil: null,
    finish: 'nonfoil',
    quantity: 2,
    addedAt: 30,
  });
  const missing = entry({
    id: 'bird:nonfoil',
    scryfallId: 'bird',
    oracleId: 'oracle-bird',
    name: 'Birds of Paradise',
    set: 'lea',
    setName: 'Limited Edition Alpha',
    colorIdentity: ['G'],
    typeLine: 'Creature — Bird',
    priceUsd: null,
    priceUsdFoil: null,
    quantity: 1,
    addedAt: 5,
    rarity: 'rare',
  });

  it('uses the foil price only for foil cards', () => {
    expect(unitPrice(bolt)).toBe(1.5);
    expect(unitPrice(foil)).toBe(2.25);
  });

  it('summarizes counts, unique names, value, and color buckets', () => {
    const summary = summarize([bolt, foil, ring, missing]);
    expect(summary.totalCards).toBe(8);
    expect(summary.uniqueCards).toBe(3);
    expect(summary.printings).toBe(4);
    expect(summary.value).toBeCloseTo(4 * 1.5 + 2.25 + 2);
    expect(summary.missingPrices).toBe(1);
    expect(summary.colors.find((color) => color.key === 'R')?.count).toBe(5);
    expect(summary.colors.find((color) => color.key === 'C')?.count).toBe(2);
    expect(summary.colors.find((color) => color.key === 'G')?.count).toBe(1);
    expect(summary.sets[0].set).toBe('mh2');
  });

  it('filters by color, type, set, rarity, and search together', () => {
    const cards = [bolt, ring, missing];
    expect(filterEntries(cards, { ...EMPTY_FILTERS, colors: ['R'] }).map((card) => card.name)).toEqual(['Lightning Bolt']);
    expect(filterEntries(cards, { ...EMPTY_FILTERS, colors: ['C'] }).map((card) => card.name)).toEqual(['Sol Ring']);
    expect(filterEntries(cards, { ...EMPTY_FILTERS, types: ['Creature'] }).map((card) => card.name)).toEqual(['Birds of Paradise']);
    expect(filterEntries(cards, { ...EMPTY_FILTERS, set: 'lea', rarities: ['rare'] })).toHaveLength(1);
    expect(filterEntries(cards, { ...EMPTY_FILTERS, query: 'paradise' })).toHaveLength(1);
    expect(filterEntries(cards, { ...EMPTY_FILTERS, colors: ['R'], types: ['Artifact'] })).toHaveLength(0);
  });

  it('sorts by price with missing prices last', () => {
    const sorted = sortEntries([missing, ring, bolt], 'price-desc').map((card) => card.name);
    expect(sorted).toEqual(['Lightning Bolt', 'Sol Ring', 'Birds of Paradise']);
    expect(sortEntries([missing, ring, bolt], 'price-asc').at(-1)?.name).toBe('Birds of Paradise');
  });

  it('merges quantities without losing the earlier add date', () => {
    const merged = mergeIntoCollection([bolt], [entry({ quantity: 2, addedAt: 99, priceUsd: 3 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(6);
    expect(merged[0].addedAt).toBe(10);
    expect(merged[0].priceUsd).toBe(3);
  });
});
