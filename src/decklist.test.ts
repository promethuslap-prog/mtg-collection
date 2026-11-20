import { describe, expect, it } from 'vitest';
import { groupDeckLines, parseDecklist } from './decklist';

describe('parseDecklist', () => {
  it('reads quantities, sets, foil markers, and skips comments', () => {
    const parsed = parseDecklist(`
// comment
# another
Deck
4 Lightning Bolt
2x Counterspell
x3 Opt
1 Sol Ring (C21) 263
1 Teferi, Hero of Dominaria (DOM) 207 *F*
1 Thought Monitor (MH2) 71 *ETCHED*

Sideboard
SB: 2 Duress
SB 1 Spell Pierce [MH2]
4 Giant Growth # favorite
Lands
1 Command Tower (C21)
`);

    expect(parsed.error).toBeNull();
    const byName = Object.fromEntries(parsed.lines.map((line) => [line.name, line]));
    expect(byName['Lightning Bolt'].quantity).toBe(4);
    expect(byName['Lightning Bolt'].finish).toBe('nonfoil');
    expect(byName.Counterspell.quantity).toBe(2);
    expect(byName.Opt.quantity).toBe(3);
    expect(byName['Sol Ring']).toMatchObject({ set: 'c21', collectorNumber: '263', finish: 'nonfoil' });
    expect(byName['Teferi, Hero of Dominaria']).toMatchObject({ set: 'dom', collectorNumber: '207', finish: 'foil' });
    expect(byName['Thought Monitor'].finish).toBe('etched');
    expect(byName.Duress.quantity).toBe(2);
    expect(byName['Spell Pierce']).toMatchObject({ set: 'mh2', finish: 'nonfoil' });
    expect(byName['Giant Growth'].quantity).toBe(4);
    expect(byName['Command Tower'].set).toBe('c21');
    expect(parsed.lines.some((line) => line.name === 'Sideboard' || line.name === 'Lands')).toBe(false);
  });

  it('keeps punctuation in card names', () => {
    const parsed = parseDecklist(`1 Kongming, "Sleeping Dragon"\n1 Lim-Dûl's Vault\n1 Fire // Ice (MH2) 251`);
    expect(parsed.lines.map((line) => line.name)).toEqual([
      'Kongming, "Sleeping Dragon"',
      "Lim-Dûl's Vault",
      'Fire // Ice',
    ]);
    expect(parsed.lines[2]).toMatchObject({ set: 'mh2', collectorNumber: '251' });
  });

  it('rejects an oversized list', () => {
    const parsed = parseDecklist(Array.from({ length: 2001 }, () => '1 Forest').join('\n'));
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.error).toMatch(/2000/);
  });
});

describe('groupDeckLines', () => {
  it('sums copies and keeps foil separate', () => {
    const parsed = parseDecklist('4 Lightning Bolt\n2 Lightning Bolt\n1 Lightning Bolt *F*');
    const groups = groupDeckLines(parsed.lines);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.finish === 'nonfoil')?.quantity).toBe(6);
    expect(groups.find((group) => group.finish === 'foil')?.quantity).toBe(1);
  });
});
