import { describe, expect, it } from 'vitest';
import { cardToEntry, type ScryfallCard } from './cards';
import { parseCollectionCsv, parseCollectionJson, serializeCollection, serializeCsv } from './io';

const card: ScryfallCard = {
  id: 'id-1',
  oracle_id: 'oracle-1',
  name: 'Kongming, "Sleeping Dragon"',
  type_line: 'Legendary Creature — Human Advisor',
  color_identity: ['W', 'U'],
  set: 'cmm',
  set_name: 'Commander Masters',
  collector_number: '917',
  rarity: 'rare',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '0.40', usd_foil: '0.80', usd_etched: null },
  image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/b/id-1.jpg' },
  scryfall_uri: 'https://scryfall.com/card/cmm/917',
};

describe('backup files', () => {
  const entry = cardToEntry(card, 'nonfoil', 2, 80);

  it('round-trips JSON', () => {
    const parsed = parseCollectionJson(serializeCollection([entry], 80));
    expect(parsed.error).toBeNull();
    expect(parsed.pricesUpdatedAt).toBe(80);
    expect(parsed.entries[0]).toMatchObject({ name: entry.name, quantity: 2, scryfallId: 'id-1', colorIdentity: ['W', 'U'] });
    const scanned = { ...entry, source: 'scanned' as const, language: 'en', scannedAt: 90, condition: 'Near Mint' };
    const restored = parseCollectionJson(serializeCollection([scanned], null));
    expect(restored.entries[0]).toMatchObject({ source: 'scanned', language: 'en', scannedAt: 90, id: 'scanned:id-1:nonfoil:en' });
  });

  it('round-trips CSV including quotes in the name', () => {
    const parsed = parseCollectionCsv(serializeCsv([entry]));
    expect(parsed.error).toBeNull();
    expect(parsed.entries[0]).toMatchObject({
      name: 'Kongming, "Sleeping Dragon"',
      set: 'cmm',
      collectorNumber: '917',
      quantity: 2,
      priceUsd: 0.4,
    });
  });

  it('reads a small spreadsheet with a foil column', () => {
    const parsed = parseCollectionCsv('name,quantity,foil\nLightning Bolt,4,true\n');
    expect(parsed.entries[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 4, finish: 'foil' });
  });
});
