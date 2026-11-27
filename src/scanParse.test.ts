import { describe, expect, it } from 'vitest';
import { moxfieldScanCsv, moxfieldScanText } from './scanExport';
import { chooseRecognition, cleanOcrName, nameSimilarity, parseCollectorLine } from './scanParse';
import type { CollectionEntry } from './types';

describe('collector line parser', () => {
  it('reads a set code and collector number', () => {
    expect(parseCollectorLine('M3C 4')).toEqual({ set: 'm3c', number: '4' });
    expect(parseCollectorLine('M3C • EN 0004')).toMatchObject({ set: 'm3c', number: '4' });
    expect(parseCollectorLine('R 0204\nFDN « EN')).toMatchObject({ set: 'fdn', number: '204' });
    expect(parseCollectorLine('MH2 285/303 R')).toMatchObject({ set: 'mh2', number: '285', rarity: 'R' });
  });

  it('reads a number and rarity when the set code is missing', () => {
    expect(parseCollectorLine('123/281 R')).toEqual({ number: '123', rarity: 'R' });
  });

  it('ignores text that is not a collector line', () => {
    expect(parseCollectorLine('the artist name')).toBeNull();
    expect(parseCollectorLine('')).toBeNull();
  });
});

describe('name matching', () => {
  it('matches an OCR title to the printed card name', () => {
    expect(cleanOcrName('Krenko, Mob Boss')).toBe('Krenko, Mob Boss');
    expect(nameSimilarity('Krenko Mob Boss', 'Krenko, Mob Boss')).toBeGreaterThan(0.9);
    expect(nameSimilarity('Ulalek, Fused Atrocity Ox', 'Ulalek, Fused Atrocity')).toBeGreaterThan(0.8);
    expect(nameSimilarity('Lightning Bolt', 'Ulalek, Fused Atrocity')).toBeLessThan(0.4);
  });

  it('prefers the set and number when it agrees with the title', () => {
    const choice = chooseRecognition({
      ocrName: 'Krenko, Mob Boss',
      collector: { set: 'fdn', number: '204' },
      setName: 'Krenko, Mob Boss',
      fuzzyName: 'Krenko, Mob Boss',
      autocomplete: ['Krenko, Mob Boss', 'Krenko, Tin Street Kingpin'],
    });
    expect(choice).toMatchObject({ source: 'set-number', name: 'Krenko, Mob Boss' });
    expect(choice!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('rejects a set hit that names a different card', () => {
    const choice = chooseRecognition({
      ocrName: 'Ulalek, Fused Atrocity',
      collector: { set: 'm3c', number: '4' },
      setName: 'Sol Ring',
      fuzzyName: 'Ulalek, Fused Atrocity',
      autocomplete: ['Ulalek, Fused Atrocity'],
    });
    expect(choice).toMatchObject({ source: 'fuzzy', name: 'Ulalek, Fused Atrocity' });
  });

  it('falls back to the closest autocomplete name', () => {
    const choice = chooseRecognition({
      ocrName: 'Krenko Mob Bos',
      collector: null,
      setName: null,
      fuzzyName: null,
      autocomplete: ['Kraken', 'Krenko, Mob Boss'],
    });
    expect(choice?.name).toBe('Krenko, Mob Boss');
    expect(choice?.source).toBe('autocomplete');
  });
});

describe('scan export', () => {
  it('writes a Moxfield CSV without prices', () => {
    const entry = {
      quantity: 1,
      name: 'Krenko, Mob Boss',
      set: 'fdn',
      condition: 'Near Mint',
      language: 'en',
      finish: 'nonfoil',
      collectorNumber: '204',
      priceUsd: 12,
    } as CollectionEntry;
    const csv = moxfieldScanCsv([entry]);
    expect(csv.split('\n')[0]).toBe('Count,Name,Edition,Condition,Language,Foil,Collector Number');
    expect(csv).toContain('1,"Krenko, Mob Boss",FDN,NM,en,,204');
    expect(csv).not.toContain('12');
    expect(moxfieldScanText([entry])).toBe('1 Krenko, Mob Boss (FDN) 204\n');
  });
});
