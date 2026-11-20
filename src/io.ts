import { entryKey, parseMoney, safeImage, safeScryfallUri } from './cards';
import type { CollectionEntry, Finish } from './types';

const CSV_COLUMNS = [
  'name',
  'set',
  'set_name',
  'collector_number',
  'finish',
  'quantity',
  'rarity',
  'type_line',
  'color_identity',
  'price_usd',
  'price_usd_foil',
  'price_usd_etched',
  'scryfall_id',
  'oracle_id',
  'image',
  'image_back',
  'scryfall_uri',
  'artist',
  'added_at',
  'condition',
  'from_tcgplayer',
] as const;

export interface SavedFile {
  version: 1;
  exportedAt: string;
  pricesUpdatedAt: number | null;
  entries: CollectionEntry[];
}

function colorList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (typeof value !== 'string') return [];
    return [...new Set((value.toUpperCase().match(/[WUBRG]/g) ?? []))];
  }
  const colors: string[] = [];
  for (const color of value) {
    if (typeof color !== 'string') continue;
    const letter = color.toUpperCase();
    if (letter.length === 1 && 'WUBRG'.includes(letter) && !colors.includes(letter)) colors.push(letter);
  }
  return colors;
}

export function sanitizeEntry(value: unknown): CollectionEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<CollectionEntry>;
  if (typeof entry.name !== 'string' || !entry.name.trim()) return null;
  if (typeof entry.scryfallId !== 'string' || !entry.scryfallId.trim()) return null;
  const finish: Finish = entry.finish === 'foil' || entry.finish === 'etched' ? entry.finish : 'nonfoil';
  const quantity = Math.floor(Number(entry.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) return null;
  const scryfallId = entry.scryfallId.trim();
  const imageBack = safeImage(typeof entry.imageBack === 'string' ? entry.imageBack : undefined);
  return {
    id: entryKey(scryfallId, finish),
    scryfallId,
    oracleId: typeof entry.oracleId === 'string' ? entry.oracleId : '',
    name: entry.name.trim(),
    set: typeof entry.set === 'string' ? entry.set.toLowerCase() : '',
    setName: typeof entry.setName === 'string' ? entry.setName : '',
    collectorNumber: typeof entry.collectorNumber === 'string' ? entry.collectorNumber : '',
    rarity: typeof entry.rarity === 'string' && entry.rarity ? entry.rarity : 'unknown',
    colorIdentity: colorList(entry.colorIdentity),
    typeLine: typeof entry.typeLine === 'string' ? entry.typeLine : '',
    image: safeImage(typeof entry.image === 'string' ? entry.image : undefined) ?? '',
    ...(imageBack ? { imageBack } : {}),
    priceUsd: parseMoney(entry.priceUsd),
    priceUsdFoil: parseMoney(entry.priceUsdFoil),
    priceUsdEtched: parseMoney(entry.priceUsdEtched),
    finish,
    quantity: Math.min(9999, quantity),
    addedAt: typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt) ? entry.addedAt : Date.now(),
    scryfallUri: safeScryfallUri(typeof entry.scryfallUri === 'string' ? entry.scryfallUri : undefined) ?? '',
    ...(typeof entry.artist === 'string' && entry.artist ? { artist: entry.artist } : {}),
    ...(typeof entry.condition === 'string' && entry.condition.trim() ? { condition: entry.condition.trim() } : {}),
    ...(entry.fromTcgplayer === true ? { fromTcgplayer: true } : {}),
  };
}

export function serializeCollection(entries: CollectionEntry[], pricesUpdatedAt: number | null): string {
  const file: SavedFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    pricesUpdatedAt,
    entries,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseCollectionJson(text: string): { entries: CollectionEntry[]; pricesUpdatedAt: number | null; error: string | null } {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { entries: [], pricesUpdatedAt: null, error: 'That file is not valid JSON.' };
  }

  const source = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries)
    ? (data as { entries: unknown[] }).entries
    : null;
  if (!source) return { entries: [], pricesUpdatedAt: null, error: 'That JSON file does not contain a collection.' };
  if (!Array.isArray(data) && data && typeof data === 'object' && 'version' in data && (data as { version?: number }).version !== 1) {
    return { entries: [], pricesUpdatedAt: null, error: 'That backup is from a newer version of this site.' };
  }

  const entries: CollectionEntry[] = [];
  let skipped = 0;
  for (const item of source) {
    const entry = sanitizeEntry(item);
    if (entry) entries.push(entry);
    else skipped += 1;
  }
  if (entries.length === 0) {
    return { entries: [], pricesUpdatedAt: null, error: 'No cards in that file could be read.' };
  }
  const pricesUpdatedAt =
    !Array.isArray(data) && data && typeof data === 'object' && typeof (data as { pricesUpdatedAt?: unknown }).pricesUpdatedAt === 'number'
      ? (data as { pricesUpdatedAt: number }).pricesUpdatedAt
      : null;
  return {
    entries,
    pricesUpdatedAt,
    error: skipped ? `Skipped ${skipped} unreadable rows.` : null,
  };
}

function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function serializeCsv(entries: CollectionEntry[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const entry of entries) {
    const values: Array<string | number | null> = [
      entry.name,
      entry.set,
      entry.setName,
      entry.collectorNumber,
      entry.finish,
      entry.quantity,
      entry.rarity,
      entry.typeLine,
      entry.colorIdentity.join(','),
      entry.priceUsd,
      entry.priceUsdFoil,
      entry.priceUsdEtched,
      entry.scryfallId,
      entry.oracleId,
      entry.image,
      entry.imageBack ?? '',
      entry.scryfallUri,
      entry.artist ?? '',
      entry.addedAt,
      entry.condition ?? '',
      entry.fromTcgplayer ? 'true' : '',
    ];
    rows.push(values.map((value) => csvCell(value)).join(','));
  }
  return `${rows.join('\n')}\n`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else inQuotes = false;
      } else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim() !== ''));
}

function undoFormula(value: string): string {
  if (value.startsWith("'") && /^[=+\-@]/.test(value.slice(1))) return value.slice(1);
  return value;
}

function headerIndex(headers: string[], names: string[]): number {
  return headers.findIndex((header) => names.includes(header));
}

function finishFromRow(row: Record<string, string>): Finish {
  const finish = (row.finish || '').toLowerCase();
  if (finish === 'foil' || finish === 'etched' || finish === 'nonfoil') return finish;
  const foil = (row.foil || '').toLowerCase();
  if (['true', 'yes', '1', 'foil'].includes(foil)) return 'foil';
  if (foil === 'etched') return 'etched';
  return 'nonfoil';
}

export function parseCollectionCsv(text: string): { entries: CollectionEntry[]; error: string | null } {
  const table = parseCsv(text);
  if (table.length < 2) return { entries: [], error: 'That CSV file has no card rows.' };
  const headers = table[0].map((header) => header.trim().toLowerCase());
  const nameIndex = headerIndex(headers, ['name', 'card', 'cardname', 'card_name']);
  if (nameIndex === -1) return { entries: [], error: 'The CSV needs a name column.' };

  const entries: CollectionEntry[] = [];
  let skipped = 0;
  for (const cells of table.slice(1)) {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = undoFormula((cells[index] ?? '').trim());
    });
    const name = row.name || row.card || row.cardname || row.card_name || '';
    const quantity = Math.floor(Number(row.quantity || row.qty || row.count || '1'));
    const scryfallId = row.scryfall_id || row.id || '';
    const set = (row.set || row.set_code || row.edition || '').toLowerCase();
    const collectorNumber = row.collector_number || row.number || row.collector || '';
    const finish = finishFromRow(row);
    const fallbackId = `manual:${name.toLowerCase()}:${set}:${collectorNumber}:${finish}`;
    const entry = sanitizeEntry({
      name,
      scryfallId: scryfallId || fallbackId,
      oracleId: row.oracle_id || '',
      set,
      setName: row.set_name || row.setname || '',
      collectorNumber,
      rarity: row.rarity || 'unknown',
      typeLine: row.type_line || row.type || '',
      colorIdentity: row.color_identity || row.colors || '',
      image: row.image || '',
      imageBack: row.image_back || '',
      priceUsd: row.price_usd || row.price || null,
      priceUsdFoil: row.price_usd_foil || null,
      priceUsdEtched: row.price_usd_etched || null,
      finish,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      addedAt: Number(row.added_at) || Date.now(),
      scryfallUri: row.scryfall_uri || '',
      artist: row.artist || '',
      condition: row.condition || '',
      fromTcgplayer: ['true', 'yes', '1'].includes((row.from_tcgplayer || '').toLowerCase()),
    });
    if (entry) entries.push(entry);
    else skipped += 1;
  }

  if (entries.length === 0) return { entries: [], error: 'No cards in that CSV could be read.' };
  return { entries, error: skipped ? `Skipped ${skipped} unreadable rows.` : null };
}

export function downloadText(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportFilename(extension: 'json' | 'csv'): string {
  const day = new Date().toISOString().slice(0, 10);
  return `mtg-collection-${day}.${extension}`;
}
