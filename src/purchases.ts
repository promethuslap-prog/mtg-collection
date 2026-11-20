import { normalizeName } from './text';
import type { CollectionEntry } from './types';

export interface PurchaseItem {
  qty: number;
  set: string;
  name: string;
  condition: string;
  foil: boolean;
  raw: string;
}

export interface PurchaseOrder {
  id: string;
  date: string;
  source: string;
  items: PurchaseItem[];
}

export interface PurchaseFile {
  version: 1;
  updatedAt: string | null;
  orders: PurchaseOrder[];
}

export interface ParsedPurchase {
  orderId: string;
  qty: number;
  name: string;
  setLabel: string;
  setCode: string | null;
  collectorNumber: string | null;
  variant: string | null;
  printingHint: string | null;
  playerInitials: string | null;
  foil: boolean;
  etched: boolean;
  condition: string | null;
  raw: string;
  skipReason: string | null;
}

export interface KnownSet {
  code: string;
  name: string;
  setType?: string;
}

export interface QuantityDelta {
  id: string;
  added: number;
}

const PRODUCT = /\b(booster box|booster pack|gift box|prerelease kit|sleeves|playmat|deck box|starter kit|fat pack|scene box)\b/i;

const SET_ALIASES: Record<string, string> = {
  'the list reprints': 'plst',
  'the list': 'plst',
  'secret lair drop series': 'sld',
  'secret lair countdown kit': 'slc',
  'secret lair countdown': 'slc',
  'revised edition': '3ed',
  'unlimited edition': '2ed',
  'limited edition alpha': 'lea',
  'limited edition beta': 'leb',
  'fourth edition': '4ed',
  'fifth edition': '5ed',
  'modern masters 2015': 'mm2',
  'modern masters 2017': 'mm3',
  'core set 2019': 'm19',
  'core set 2020': 'm20',
  'core set 2021': 'm21',
};

export function parsePurchaseFile(data: unknown): PurchaseFile | null {
  if (!data || typeof data !== 'object') return null;
  const file = data as { version?: unknown; updatedAt?: unknown; orders?: unknown };
  if (file.version !== 1 || !Array.isArray(file.orders)) return null;
  const orders: PurchaseOrder[] = [];
  for (const value of file.orders) {
    const order = parseOrder(value);
    if (order) orders.push(order);
  }
  if (orders.length === 0) return null;
  return {
    version: 1,
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : null,
    orders,
  };
}

function parseOrder(value: unknown): PurchaseOrder | null {
  if (!value || typeof value !== 'object') return null;
  const order = value as { id?: unknown; date?: unknown; source?: unknown; items?: unknown };
  if (typeof order.id !== 'string' || !order.id.trim() || !Array.isArray(order.items)) return null;
  const items: PurchaseItem[] = [];
  for (const item of order.items) {
    const parsed = parseItem(item);
    if (parsed) items.push(parsed);
  }
  return {
    id: order.id.trim(),
    date: typeof order.date === 'string' ? order.date : '',
    source: typeof order.source === 'string' ? order.source : 'TCGplayer',
    items,
  };
}

function parseItem(value: unknown): PurchaseItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as { qty?: unknown; set?: unknown; name?: unknown; condition?: unknown; foil?: unknown; raw?: unknown };
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const set = typeof item.set === 'string' ? item.set.trim() : '';
  const raw = typeof item.raw === 'string' ? item.raw.trim() : '';
  if (!name && !raw) return null;
  const qty = Math.floor(Number(item.qty ?? 1));
  return {
    qty: Number.isFinite(qty) && qty > 0 ? Math.min(9999, qty) : 1,
    set,
    name,
    condition: typeof item.condition === 'string' ? item.condition.trim() : '',
    foil: item.foil === true,
    raw,
  };
}

export function splitTrailingNotes(value: string): { base: string; notes: string[] } {
  const notes: string[] = [];
  let base = value.trim();
  let match = /\(([^()]*)\)\s*$/.exec(base);
  while (match && match.index > 0) {
    notes.unshift(match[1].trim());
    base = base.slice(0, match.index).trim();
    match = /\(([^()]*)\)\s*$/.exec(base);
  }
  return { base, notes };
}

function isSetCode(note: string): boolean {
  return /^[A-Za-z0-9]{3,6}$/.test(note) && !/^\d+$/.test(note);
}

function isCollectorNumber(note: string): boolean {
  if (!/^\d{1,5}[A-Za-z]?$/.test(note)) return false;
  const year = Number(note);
  return !(year >= 1993 && year <= 2035 && note.length === 4);
}

function cleanCondition(condition: string, foil: boolean, etched: boolean): string | null {
  const cleaned = condition
    .replace(/\bfoil\b/gi, '')
    .replace(/\betched\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) return cleaned;
  if (foil || etched || condition) return null;
  return null;
}

function initials(player: string): string | null {
  const parts = player.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toLowerCase();
}

export function parsePurchase(orderId: string, item: PurchaseItem, catalog: KnownSet[]): ParsedPurchase {
  const championship = /^(.*?)\s+-\s+((?:19|20)\d{2})\s+(.+)$/.exec(item.name.trim());
  const worldChampionship = normalizeName(item.set).startsWith('world championship deck');
  let name = item.name.trim();
  let notes: string[] = [];
  let playerInitials: string | null = null;
  let championshipCode: string | null = null;
  if (championship && worldChampionship) {
    name = championship[1].trim();
    const year = championship[2];
    const rest = splitTrailingNotes(championship[3]);
    playerInitials = initials(rest.base);
    notes = rest.notes;
    const code = `wc${year.slice(2)}`;
    if (catalog.length === 0 || catalog.some((set) => set.code.toLowerCase() === code)) championshipCode = code;
  } else {
    const parts = splitTrailingNotes(item.name);
    name = parts.base || item.name.trim();
    notes = parts.notes;
  }

  const variantNotes = notes.filter((note) => !isCollectorNumber(note) && !isSetCode(note));
  const collectorNote = notes.find((note) => isCollectorNumber(note)) ?? null;
  const variant = variantNotes.length > 0 ? variantNotes.join(' ') : null;
  const conditionText = item.condition;
  const foil = item.foil || /\bfoil\b/i.test(conditionText) || /\bfoil\b/i.test(variant ?? '');
  const etched = /\betched\b/i.test(conditionText) || /\betched\b/i.test(variant ?? '');
  const setLabel = splitTrailingNotes(item.set).base || item.set.trim();
  const skipReason = !name ? 'Missing card name' : PRODUCT.test(name) ? 'Not a single card' : null;
  const setCode = skipReason ? null : championshipCode ?? matchSetName(item.set, catalog);
  const printingHint = setCode === 'plst'
    ? notes.find((note) => isSetCode(note))?.toLowerCase() ?? null
    : null;
  return {
    orderId,
    qty: item.qty,
    name,
    setLabel,
    setCode,
    collectorNumber: collectorNote ? collectorNote.replace(/^0+(?=\d)/, '') : null,
    variant,
    printingHint,
    playerInitials,
    foil,
    etched,
    condition: cleanCondition(conditionText, foil, etched),
    raw: item.raw || [item.set, item.name, item.condition].filter(Boolean).join(' — '),
    skipReason,
  };
}

function tokensOf(value: string): string[] {
  return normalizeName(value).split(' ').filter((token) => token && token !== 'the' && token !== 'of' && token !== 'a');
}

export function matchSetName(label: string, catalog: KnownSet[]): string | null {
  const { base, notes } = splitTrailingNotes(label);
  const codeHint = notes.find((note) => isSetCode(note));
  if (codeHint) {
    const code = codeHint.toLowerCase();
    if (catalog.some((set) => set.code.toLowerCase() === code)) return code;
  }
  const alias = SET_ALIASES[normalizeName(label)] ?? SET_ALIASES[normalizeName(base)];
  if (alias && (catalog.length === 0 || catalog.some((set) => set.code.toLowerCase() === alias))) return alias;
  const queryTokens = tokensOf(base);
  if (queryTokens.length === 0) return null;
  const querySet = new Set(queryTokens);
  let best: { code: string; score: number } | null = null;
  for (const set of catalog) {
    const setTokens = tokensOf(set.name);
    if (setTokens.length === 0) continue;
    const setSet = new Set(setTokens);
    const exact = normalizeName(base) === normalizeName(set.name);
    const equal = querySet.size === setSet.size && [...querySet].every((token) => setSet.has(token));
    const setContained = [...setSet].every((token) => querySet.has(token));
    const queryContained = [...querySet].every((token) => setSet.has(token));
    let score = 0;
    if (exact) score = 1000;
    else if (equal) score = 900;
    else if (setContained) score = 800 - (querySet.size - setSet.size) * 20;
    else if (queryContained) score = 700 - (setSet.size - querySet.size) * 30;
    else continue;
    if (set.setType === 'token' || set.setType === 'memorabilia' || set.setType === 'minigame') score -= 80;
    if (!best || score > best.score) best = { code: set.code.toLowerCase(), score };
  }
  if (!best || best.score < 640) return null;
  return best.code;
}

export function pendingOrders(file: PurchaseFile, importedIds: Iterable<string>): PurchaseOrder[] {
  const seen = new Set(importedIds);
  return file.orders.filter((order) => !seen.has(order.id));
}

export function applyQuantityUndo(entries: CollectionEntry[], deltas: QuantityDelta[]): CollectionEntry[] {
  const added = new Map(deltas.map((delta) => [delta.id, delta.added]));
  const next: CollectionEntry[] = [];
  for (const entry of entries) {
    const amount = added.get(entry.id) ?? 0;
    if (amount <= 0) {
      next.push(entry);
      continue;
    }
    const quantity = entry.quantity - amount;
    if (quantity > 0) next.push({ ...entry, quantity });
  }
  return next;
}

export function purchaseMessage(addedCards: number, orders: number): string {
  const cardText = `${addedCards.toLocaleString('en-US')} ${addedCards === 1 ? 'card' : 'cards'}`;
  const orderText = `${orders.toLocaleString('en-US')} TCGplayer ${orders === 1 ? 'order' : 'orders'}`;
  if (addedCards === 0) return `No cards matched from ${orderText}.`;
  return `Added ${cardText} from ${orderText}.`;
}
