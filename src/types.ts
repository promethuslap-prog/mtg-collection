export type Finish = 'nonfoil' | 'foil' | 'etched';

export type CardSource = 'manual' | 'moxfield' | 'tcgplayer' | 'scanned';

export type ViewMode = 'grid' | 'list';

export type SortKey =
  | 'added-desc'
  | 'added-asc'
  | 'name-asc'
  | 'name-desc'
  | 'price-desc'
  | 'price-asc';

export interface CollectionEntry {
  id: string;
  scryfallId: string;
  oracleId: string;
  name: string;
  set: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  colorIdentity: string[];
  typeLine: string;
  image: string;
  imageBack?: string;
  priceUsd: number | null;
  priceUsdFoil: number | null;
  priceUsdEtched: number | null;
  finish: Finish;
  quantity: number;
  addedAt: number;
  scryfallUri: string;
  artist?: string;
  condition?: string;
  language?: string;
  scannedAt?: number;
  fromTcgplayer?: boolean;
  source?: CardSource;
}

export interface Filters {
  query: string;
  colors: string[];
  types: string[];
  rarities: string[];
  set: string;
  tcgplayer: boolean;
  moxfield: boolean;
  scanned: boolean;
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  colors: [],
  types: [],
  rarities: [],
  set: '',
  tcgplayer: false,
  moxfield: false,
  scanned: false,
};
