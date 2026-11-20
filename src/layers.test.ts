import { describe, expect, it } from 'vitest';
import { layerChangeNote, manualEntriesAfterImport, oracleNames, withoutMoxfieldNames } from './layers';
import type { CollectionEntry } from './types';

function entry(partial: Partial<CollectionEntry>): CollectionEntry {
  return {
    id: partial.id ?? `${partial.scryfallId ?? 'x'}:${partial.finish ?? 'nonfoil'}`,
    scryfallId: partial.scryfallId ?? 'x',
    oracleId: '',
    name: partial.name ?? 'Card',
    set: 'x',
    setName: '',
    collectorNumber: '1',
    rarity: 'common',
    colorIdentity: [],
    typeLine: '',
    image: '',
    priceUsd: null,
    priceUsdFoil: null,
    priceUsdEtched: null,
    finish: partial.finish ?? 'nonfoil',
    quantity: partial.quantity ?? 1,
    addedAt: 1,
    scryfallUri: '',
    ...partial,
  };
}

describe('collection layers', () => {
  it('removes only the old TCGplayer quantities and keeps a manual addition', () => {
    const stored = [
      entry({ scryfallId: 'bolt', name: 'Lightning Bolt', quantity: 4 }),
      entry({ scryfallId: 'abrade', name: 'Abrade', quantity: 2, fromTcgplayer: true }),
      entry({ scryfallId: 'ring', name: 'The One Ring', quantity: 3, fromTcgplayer: true }),
    ];
    const imported = [
      entry({ scryfallId: 'abrade', name: 'Abrade', quantity: 1, fromTcgplayer: true }),
      entry({ scryfallId: 'ring', name: 'The One Ring', quantity: 1, fromTcgplayer: true }),
    ];
    const manual = manualEntriesAfterImport(stored, imported);
    expect(manual.map((item) => [item.name, item.quantity, item.fromTcgplayer])).toEqual([
      ['Lightning Bolt', 4, undefined],
      ['Abrade', 1, undefined],
      ['The One Ring', 2, undefined],
    ]);
  });

  it('drops a TCGplayer card whose name is already in Moxfield', () => {
    const names = oracleNames([entry({ name: 'The One Ring' })], ['Abrade']);
    const kept = withoutMoxfieldNames(
      [entry({ name: 'The One Ring' }), entry({ name: 'Abrade' }), entry({ name: 'Basalt Monolith' })],
      names,
    );
    expect(kept.map((item) => item.name)).toEqual(['Basalt Monolith']);
  });

  it('describes layer changes since the last visit', () => {
    const previous = [entry({ quantity: 2 })];
    const next = [entry({ quantity: 5 })];
    expect(layerChangeNote(previous, next, [], [entry({ quantity: 1, name: 'Other', scryfallId: 'y' })])).toBe('+3 from Moxfield, +1 from TCGplayer');
    expect(layerChangeNote(next, next, [], [])).toBeNull();
  });
});
