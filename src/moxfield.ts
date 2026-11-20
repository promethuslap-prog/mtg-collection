export interface MoxfieldCard {
  qty: number;
  name: string;
  set: string;
  collectorNumber: string;
  foil: '' | 'foil' | 'etched';
  condition: string;
  language: string;
}

export interface MoxfieldFile {
  version: 1;
  source: string;
  updatedAt: string | null;
  cards: MoxfieldCard[];
}

export function parseMoxfieldFile(data: unknown): MoxfieldFile | null {
  if (!data || typeof data !== 'object') return null;
  const file = data as { version?: unknown; source?: unknown; updatedAt?: unknown; cards?: unknown };
  if (file.version !== 1 || !Array.isArray(file.cards)) return null;
  const cards: MoxfieldCard[] = [];
  for (const value of file.cards) {
    const card = parseCard(value);
    if (card) cards.push(card);
  }
  if (cards.length === 0) return null;
  return {
    version: 1,
    source: typeof file.source === 'string' ? file.source : 'Moxfield',
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : null,
    cards,
  };
}

function parseCard(value: unknown): MoxfieldCard | null {
  if (!value || typeof value !== 'object') return null;
  const card = value as Partial<MoxfieldCard>;
  if (typeof card.name !== 'string' || !card.name.trim()) return null;
  if (typeof card.set !== 'string' || !card.set.trim()) return null;
  if (typeof card.collectorNumber !== 'string' || !card.collectorNumber.trim()) return null;
  const qty = Math.floor(Number(card.qty ?? 1));
  const foil = card.foil === 'foil' || card.foil === 'etched' ? card.foil : '';
  return {
    qty: Number.isFinite(qty) && qty > 0 ? Math.min(9999, qty) : 1,
    name: card.name.trim(),
    set: card.set.trim().toLowerCase(),
    collectorNumber: card.collectorNumber.trim(),
    foil,
    condition: typeof card.condition === 'string' ? card.condition.trim() : '',
    language: typeof card.language === 'string' ? card.language.trim() : '',
  };
}
