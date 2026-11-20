export interface DeckCardLine {
  qty: number;
  name: string;
  set: string;
  collectorNumber: string;
  foil: '' | 'foil' | 'etched' | boolean;
}

export interface DeckRecord {
  id: string;
  name: string;
  format: 'commander' | 'standard';
  commanders: string[];
  url: string;
  mainboard: DeckCardLine[];
  sideboard: DeckCardLine[];
  pasted?: boolean;
}

export interface DeckFile {
  version: number;
  source: string;
  updatedAt: string | null;
  decks: DeckRecord[];
}

export function parseDeckFile(data: unknown): DeckFile | null {
  if (!data || typeof data !== 'object') return null;
  const file = data as { version?: unknown; source?: unknown; updatedAt?: unknown; decks?: unknown };
  if (!Array.isArray(file.decks)) return null;
  const decks: DeckRecord[] = [];
  for (const value of file.decks) {
    const deck = parseDeck(value);
    if (deck) decks.push(deck);
  }
  if (decks.length === 0) return null;
  return {
    version: typeof file.version === 'number' ? file.version : 1,
    source: typeof file.source === 'string' ? file.source : 'Moxfield',
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : null,
    decks,
  };
}

function parseDeck(value: unknown): DeckRecord | null {
  if (!value || typeof value !== 'object') return null;
  const deck = value as Partial<DeckRecord>;
  if (typeof deck.id !== 'string' || typeof deck.name !== 'string') return null;
  const format = deck.format === 'standard' ? 'standard' : 'commander';
  return {
    id: deck.id,
    name: deck.name,
    format,
    commanders: Array.isArray(deck.commanders) ? deck.commanders.filter((name): name is string => typeof name === 'string') : [],
    url: typeof deck.url === 'string' ? deck.url : '',
    mainboard: parseLines(deck.mainboard),
    sideboard: parseLines(deck.sideboard),
  };
}

function parseLines(value: unknown): DeckCardLine[] {
  if (!Array.isArray(value)) return [];
  const lines: DeckCardLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const line = item as Partial<DeckCardLine>;
    if (typeof line.name !== 'string' || !line.name.trim()) continue;
    const qty = Math.floor(Number(line.qty ?? 1));
    const foil = line.foil === 'etched' || line.foil === 'foil' || line.foil === true
      ? (line.foil === true ? 'foil' : line.foil)
      : '';
    lines.push({
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      name: line.name.trim(),
      set: typeof line.set === 'string' ? line.set.toLowerCase() : '',
      collectorNumber: typeof line.collectorNumber === 'string' ? line.collectorNumber : '',
      foil,
    });
  }
  return lines;
}

export function deckSize(deck: DeckRecord): number {
  return deck.mainboard.reduce((sum, line) => sum + line.qty, 0);
}

export function formatTarget(format: DeckRecord['format']): number {
  return format === 'commander' ? 100 : 60;
}
