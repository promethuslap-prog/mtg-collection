import type { CollectionEntry, Finish } from './types';
import { unitPrice } from './collection';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return usd.format(value);
}

export function formatWhen(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

export function finishLabel(finish: Finish): string {
  if (finish === 'foil') return 'Foil';
  if (finish === 'etched') return 'Etched';
  return 'Nonfoil';
}

export function rarityLabel(rarity: string): string {
  if (!rarity) return 'Unknown';
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

export function priceLabel(entry: CollectionEntry): string {
  const price = unitPrice(entry);
  const amount = formatUsd(price);
  if (entry.finish === 'foil') return price == null ? 'Foil —' : `Foil ${amount}`;
  if (entry.finish === 'etched') return price == null ? 'Etched —' : `Etched ${amount}`;
  return amount;
}

export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}
