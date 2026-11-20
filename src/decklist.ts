import type { Finish } from './types';

export type DeckSection = 'commander' | 'mainboard' | 'sideboard' | 'maybeboard';

export interface ParsedLine {
  lineNumber: number;
  raw: string;
  quantity: number;
  name: string;
  set?: string;
  collectorNumber?: string;
  finish: Finish;
  section: DeckSection;
}

export interface DeckParse {
  lines: ParsedLine[];
  error: string | null;
}

const SECTION_HEADER =
  /^(about|deck|main\s*deck|maindeck|sideboard|commander|companion|maybeboard|considering|tokens?|creatures?|instants?|sorceries|enchantments?|artifacts?|lands?|planeswalkers?|battles?|other)$/i;

export function parseDecklist(text: string): DeckParse {
  const cleaned = text.replace(/^\uFEFF/, '');
  const rawLines = cleaned.split(/\r?\n/);
  if (rawLines.length > 5000) {
    return { lines: [], error: 'That list is too long. Paste up to 5000 lines at a time.' };
  }

  const lines: ParsedLine[] = [];
  let section: DeckSection = 'mainboard';
  rawLines.forEach((original, index) => {
    let raw = original.trim();
    if (!raw || raw.startsWith('//') || raw.startsWith('#')) return;
    if (SECTION_HEADER.test(raw)) {
      if (/commander/i.test(raw)) section = 'commander';
      else if (/sideboard/i.test(raw)) section = 'sideboard';
      else if (/maybe|consider/i.test(raw)) section = 'maybeboard';
      else if (/deck|main/i.test(raw)) section = 'mainboard';
      return;
    }
    if (/^name\s*:/i.test(raw)) return;

    let lineSection = section;
    const sidePrefix = raw.match(/^(?:SB|Sideboard)\s*:?\s+/i);
    if (sidePrefix) {
      lineSection = 'sideboard';
      raw = raw.slice(sidePrefix[0].length).trim();
    }
    // Split cards use " // " in the name, so only # starts a trailing comment.
    raw = raw.replace(/\s+#\s.*$/, '').trim();
    if (!raw || SECTION_HEADER.test(raw)) return;

    let finish: Finish = 'nonfoil';
    const etched = raw.match(/\s*(?:\*E\*|\*ETCHED\*|\(etched\)|\[etched\])\s*$/i);
    const foil = raw.match(/\s*(?:\*F\*|\*FOIL\*|\(foil\)|\[foil\])\s*$/i);
    const foilWord = raw.match(/\s+\b(foil|etched)\b\s*$/i);
    if (etched) {
      finish = 'etched';
      raw = raw.slice(0, etched.index).trim();
    } else if (foil) {
      finish = 'foil';
      raw = raw.slice(0, foil.index).trim();
    } else if (foilWord) {
      finish = foilWord[1].toLowerCase() === 'etched' ? 'etched' : 'foil';
      raw = raw.slice(0, foilWord.index).trim();
    }

    let quantity = 1;
    const qty = raw.match(/^(?:(\d+)\s*x?\s+|x\s*(\d+)\s+)/i);
    if (qty) {
      quantity = Math.min(9999, Math.max(1, Number.parseInt(qty[1] || qty[2] || '1', 10)));
      raw = raw.slice(qty[0].length).trim();
    }
    if (!raw) return;

    let name = raw;
    let setCode: string | undefined;
    let collectorNumber: string | undefined;
    const withSet = raw.match(/^(.*\S)\s+[\(\[]([A-Za-z0-9]{3,6})[\)\]](?:\s+([A-Za-z0-9★*]{1,8}))?\s*$/);
    if (withSet) {
      name = withSet[1].trim();
      setCode = withSet[2].toLowerCase();
      collectorNumber = withSet[3];
    }
    if (!name) return;

    lines.push({
      lineNumber: index + 1,
      raw: original.trim(),
      quantity,
      name,
      set: setCode,
      collectorNumber,
      finish,
      section: lineSection,
    });
  });

  if (lines.length > 2000) {
    return { lines: [], error: 'That list has more than 2000 cards. Split it into smaller pastes.' };
  }
  return { lines, error: null };
}

export interface DeckGroup {
  name: string;
  set?: string;
  collectorNumber?: string;
  finish: Finish;
  quantity: number;
  lineNumbers: number[];
}

export function groupDeckLines(lines: ParsedLine[]): DeckGroup[] {
  const groups = new Map<string, DeckGroup>();
  for (const line of lines) {
    const key = [line.name.toLowerCase(), line.set ?? '', line.collectorNumber ?? '', line.finish].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.quantity = Math.min(9999, existing.quantity + line.quantity);
      existing.lineNumbers.push(line.lineNumber);
      continue;
    }
    groups.set(key, {
      name: line.name,
      set: line.set,
      collectorNumber: line.collectorNumber,
      finish: line.finish,
      quantity: line.quantity,
      lineNumbers: [line.lineNumber],
    });
  }
  return [...groups.values()];
}
