import { describe, expect, it } from 'vitest';
import { availableFinishes, cardToEntry, priceForFinish, safeImage, type ScryfallCard } from './cards';

const bolt: ScryfallCard = {
  id: 'id-1',
  oracle_id: 'oracle-1',
  name: 'Lightning Bolt',
  type_line: 'Instant',
  color_identity: ['R'],
  set: 'mh2',
  set_name: 'Modern Horizons 2',
  collector_number: '371',
  rarity: 'uncommon',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '1.50', usd_foil: '2.25', usd_etched: null },
  image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/b/id-1.jpg' },
  scryfall_uri: 'https://scryfall.com/card/mh2/371/lightning-bolt',
  artist: 'Martina Pilcerova',
  games: ['paper'],
};

describe('card mapping', () => {
  it('maps a printing and keeps only https Scryfall images', () => {
    const entry = cardToEntry(bolt, 'foil', 4, 50);
    expect(entry).toMatchObject({
      id: 'id-1:foil',
      finish: 'foil',
      quantity: 4,
      priceUsd: 1.5,
      priceUsdFoil: 2.25,
      image: 'https://cards.scryfall.io/normal/front/a/b/id-1.jpg',
      scryfallUri: 'https://scryfall.com/card/mh2/371/lightning-bolt',
      addedAt: 50,
    });
    expect(priceForFinish(bolt, 'foil')).toBe(2.25);
    expect(availableFinishes(bolt)).toEqual(['nonfoil', 'foil']);
  });

  it('uses the front face image for double-faced cards', () => {
    const card: ScryfallCard = {
      ...bolt,
      id: 'dfc',
      name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
      image_uris: undefined,
      card_faces: [
        { name: 'Fable of the Mirror-Breaker', image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/a/dfc.jpg' } },
        { name: 'Reflection of Kiki-Jiki', image_uris: { normal: 'https://cards.scryfall.io/normal/back/a/a/dfc.jpg' } },
      ],
    };
    const entry = cardToEntry(card, 'nonfoil', 1, 1);
    expect(entry.image).toContain('/front/');
    expect(entry.imageBack).toContain('/back/');
  });

  it('rejects unsafe image urls', () => {
    expect(safeImage('http://cards.scryfall.io/card.jpg')).toBeUndefined();
    expect(safeImage('https://evil.example/card.jpg')).toBeUndefined();
    expect(safeImage('javascript:alert(1)')).toBeUndefined();
  });
});
