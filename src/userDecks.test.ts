import { describe, expect, it } from 'vitest';
import type { DeckRecord } from './deckModel';
import { formatTarget } from './deckModel';
import { duplicateDeck, parseUserDeckBackup, serializeUserDecks, toMoxfieldText, userDeckFromText } from './userDecks';

const source: DeckRecord = {
  id: 'mox',
  name: 'Jadar',
  format: 'commander',
  commanders: ['Jadar, Ghoulcaller of Nephalia'],
  url: 'https://www.moxfield.com/decks/example',
  origin: 'moxfield',
  mainboard: [
    { qty: 1, name: 'Jadar, Ghoulcaller of Nephalia', set: 'mic', collectorNumber: '119', foil: '' },
    { qty: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', foil: 'foil' },
  ],
  sideboard: [],
};

describe('user decks', () => {
  it('knows format sizes', () => {
    expect(formatTarget('commander')).toBe(100);
    expect(formatTarget('brawl')).toBe(60);
    expect(formatTarget('modern')).toBe(60);
    expect(formatTarget('casual')).toBe(60);
  });

  it('duplicates a Moxfield deck into an editable copy', () => {
    const copy = duplicateDeck(source);
    expect(copy.origin).toBe('local');
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe('Jadar copy');
    expect(copy.url).toBe('');
    expect(copy.commanderBoard?.map((line) => line.name)).toEqual(['Jadar, Ghoulcaller of Nephalia']);
    expect(copy.mainboard.map((line) => line.name)).toEqual(['Sol Ring']);
    expect(source.mainboard).toHaveLength(2);
  });

  it('imports sections with the paste parser and exports Moxfield text', () => {
    const deck = userDeckFromText('Goblins', 'commander', [], `
Commander
1 Krenko, Mob Boss (M12) 132

Deck
1 Sol Ring (C21) 263

Sideboard
1 Pyroblast

Maybeboard
1 Goblin Grenade *F*
`);
    expect(deck).not.toBeNull();
    expect(deck?.commanders).toEqual(['Krenko, Mob Boss']);
    expect(deck?.mainboard[0]).toMatchObject({ name: 'Sol Ring', set: 'c21', collectorNumber: '263' });
    expect(deck?.sideboard[0].name).toBe('Pyroblast');
    expect(deck?.maybeboard?.[0]).toMatchObject({ name: 'Goblin Grenade', foil: 'foil' });
    const text = toMoxfieldText(deck!);
    expect(text).toContain('1 Sol Ring (C21) 263');
    expect(text).toContain('1 Goblin Grenade *F*');
    expect(text).toMatch(/Commander\n1 Krenko, Mob Boss \(M12\) 132/);
  });

  it('backs up and restores local decks', () => {
    const deck = userDeckFromText('Casual', 'casual', [], '4 Lightning Bolt');
    const raw = serializeUserDecks([deck!]);
    const restored = parseUserDeckBackup(raw);
    expect(restored.error).toBeNull();
    expect(restored.decks).toHaveLength(1);
    expect(restored.decks[0].mainboard[0]).toMatchObject({ name: 'Lightning Bolt', qty: 4 });
    expect(restored.decks[0].origin).toBe('local');
    const noted = { ...deck!, strategy: {
      archetype: 'Goblin Tokens',
      overview: 'Generated overview.',
      early: 'Early.',
      mid: 'Mid.',
      late: 'Late.',
      synergies: ['A + B: tokens.'],
      wins: ['Attack.'],
      mulligan: 'Three lands.',
      strengths: 'Ramp is fine.',
      weaknesses: 'Thin on card draw.',
      playAround: 'Hold a draw spell.',
      bracketNote: 'Estimated bracket: Core.',
      notes: 'My edited plan.',
    } };
    const roundTrip = parseUserDeckBackup(serializeUserDecks([noted]));
    expect(roundTrip.decks[0].strategy?.notes).toBe('My edited plan.');
    expect(roundTrip.decks[0].strategy?.archetype).toBe('Goblin Tokens');
    expect(parseUserDeckBackup('{"version":1,"entries":[]}').error).toMatch(/deck backup/);
  });
});
