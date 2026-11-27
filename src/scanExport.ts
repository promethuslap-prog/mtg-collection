import type { CollectionEntry, Finish } from './types';

const CONDITION_CODE: Record<string, string> = {
  'Near Mint': 'NM',
  'Lightly Played': 'LP',
  'Moderately Played': 'MP',
  'Heavily Played': 'HP',
  Damaged: 'DMG',
};

export function scannedEntryId(scryfallId: string, finish: Finish, language: string): string {
  return `scanned:${scryfallId}:${finish}:${(language || 'en').toLowerCase()}`;
}

export function moxfieldScanCsv(entries: CollectionEntry[]): string {
  const rows = ['Count,Name,Edition,Condition,Language,Foil,Collector Number'];
  for (const entry of entries) {
    rows.push([
      entry.quantity,
      csv(entry.name),
      csv(entry.set.toUpperCase()),
      csv(CONDITION_CODE[entry.condition ?? ''] ?? entry.condition ?? 'NM'),
      csv(entry.language || 'en'),
      entry.finish === 'nonfoil' ? '' : entry.finish,
      csv(entry.collectorNumber),
    ].join(','));
  }
  return `${rows.join('\n')}\n`;
}

export function moxfieldScanText(entries: CollectionEntry[]): string {
  return `${entries.map((entry) => `${entry.quantity} ${entry.name} (${entry.set.toUpperCase()}) ${entry.collectorNumber}`).join('\n')}\n`;
}

function csv(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
