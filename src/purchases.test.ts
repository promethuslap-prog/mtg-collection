import { describe, expect, it } from 'vitest';
import { applyQuantityUndo, parsePurchase, parsePurchaseFile, purchaseMessage, type KnownSet } from './purchases';
import type { CollectionEntry } from './types';

const catalog: KnownSet[] = [
  { code: 'm11', name: 'Magic 2011', setType: 'core' },
  { code: 'fin', name: 'Final Fantasy', setType: 'expansion' },
  { code: 'fic', name: 'Final Fantasy Commander', setType: 'commander' },
  { code: 'ltr', name: 'The Lord of the Rings: Tales of Middle-earth', setType: 'draft_innovation' },
  { code: 'plst', name: 'The List', setType: 'masters' },
  { code: 'sld', name: 'Secret Lair Drop', setType: 'box' },
  { code: 'slc', name: 'Secret Lair Countdown', setType: 'box' },
  { code: 'mb2', name: 'Mystery Booster 2', setType: 'masters' },
  { code: '3ed', name: 'Revised Edition', setType: 'core' },
  { code: 'blb', name: 'Bloomburrow', setType: 'expansion' },
  { code: 'blc', name: 'Bloomburrow Commander', setType: 'commander' },
  { code: 'wc99', name: 'World Championship Decks 1999', setType: 'memorabilia' },
  { code: 'wc00', name: 'World Championship Decks 2000', setType: 'memorabilia' },
  { code: 'dom', name: 'Dominaria', setType: 'expansion' },
  { code: 'dmu', name: 'Dominaria United', setType: 'expansion' },
];

describe('TCGplayer purchase parsing', () => {
  it('reads the version 1 file and ignores an empty one', () => {
    const file = parsePurchaseFile({
      version: 1,
      updatedAt: '2026-11-19T21:30:00-08:00',
      orders: [{ id: 'tcg-1', date: '2026-09-07', source: 'TCGplayer', items: [{ qty: 1, set: 'Dominaria', name: 'Goblin Warchief', condition: 'Lightly Played', foil: false, raw: 'Magic - Dominaria - Goblin Warchief - Lightly Played' }] }],
    });
    expect(file?.orders).toHaveLength(1);
    expect(parsePurchaseFile({ version: 1, orders: [] })).toBeNull();
    expect(parsePurchaseFile({ version: 2, orders: [] })).toBeNull();
  });

  it('maps set names, variants, collector numbers, and world championship lines', () => {
    const chieftain = parsePurchase('o', { qty: 1, set: 'Magic 2011 (M11)', name: 'Goblin Chieftain', condition: 'Lightly Played', foil: false, raw: '' }, catalog);
    expect(chieftain).toMatchObject({ name: 'Goblin Chieftain', setCode: 'm11', condition: 'Lightly Played' });

    const jeska = parsePurchase('o', { qty: 1, set: 'Commander: FINAL FANTASY', name: "Jeska's Will", condition: 'Near Mint Foil', foil: true, raw: '' }, catalog);
    expect(jeska).toMatchObject({ setCode: 'fic', foil: true, condition: 'Near Mint' });

    const ring = parsePurchase('o', { qty: 1, set: 'Universes Beyond: The Lord of the Rings: Tales of Middle-earth', name: 'The One Ring', condition: 'Near Mint', foil: false, raw: '' }, catalog);
    expect(ring.setCode).toBe('ltr');

    const list = parsePurchase('o', { qty: 1, set: 'The List Reprints', name: 'Abrade (2XM)', condition: 'Lightly Played', foil: false, raw: '' }, catalog);
    expect(list).toMatchObject({ name: 'Abrade', setCode: 'plst', printingHint: '2xm' });

    const crucible = parsePurchase('o', { qty: 1, set: 'Secret Lair Drop Series', name: 'Crucible of Worlds (7162)', condition: 'Near Mint', foil: false, raw: '' }, catalog);
    expect(crucible).toMatchObject({ name: 'Crucible of Worlds', setCode: 'sld', collectorNumber: '7162' });

    const countdown = parsePurchase('o', { qty: 1, set: 'Secret Lair Countdown Kit', name: 'Phyrexian Altar', condition: 'Near Mint', foil: false, raw: '' }, catalog);
    expect(countdown.setCode).toBe('slc');

    const terrain = parsePurchase('o', { qty: 1, set: 'Edge of Eternities: Stellar Sights', name: 'Terrain Generator (0043) (Borderless)', condition: 'Lightly Played', foil: false, raw: '' }, catalog);
    expect(terrain).toMatchObject({ collectorNumber: '43', variant: 'Borderless' });

    const tomb = parsePurchase('o', { qty: 1, set: 'World Championship Decks', name: 'Ancient Tomb - 1999 Kai Budde (TMP)', condition: 'Damaged', foil: false, raw: '' }, catalog);
    expect(tomb).toMatchObject({ name: 'Ancient Tomb', setCode: 'wc99', playerInitials: 'kb', condition: 'Damaged' });

    const monolith = parsePurchase('o', { qty: 1, set: 'World Championship Decks', name: 'Grim Monolith - 2000 Jon Finkel (ULG)', condition: 'Heavily Played', foil: false, raw: '' }, catalog);
    expect(monolith).toMatchObject({ name: 'Grim Monolith', setCode: 'wc00', playerInitials: 'jf' });

    const bloom = parsePurchase('o', { qty: 1, set: 'Commander: Bloomburrow', name: 'Agate Instigator', condition: 'Near Mint', foil: false, raw: '' }, catalog);
    expect(bloom.setCode).toBe('blc');

    const revised = parsePurchase('o', { qty: 1, set: 'Revised Edition', name: 'Birds of Paradise', condition: 'Lightly Played', foil: false, raw: '' }, catalog);
    expect(revised.setCode).toBe('3ed');
  });

  it('undoes only the imported quantity and keeps an earlier copy', () => {
    const undone = applyQuantityUndo(
      [{ id: 'bolt:nonfoil', quantity: 4 } as CollectionEntry, { id: 'ring:foil', quantity: 1 } as CollectionEntry],
      [{ id: 'bolt:nonfoil', added: 1 }, { id: 'ring:foil', added: 1 }],
    );
    expect(undone.map((entry) => [entry.id, entry.quantity])).toEqual([['bolt:nonfoil', 3]]);
    expect(purchaseMessage(7, 3)).toBe('Added 7 cards from 3 TCGplayer orders.');
  });
});
