export type Finish = 'nonfoil' | 'foil' | 'etched';

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
}

export interface Filters {
  query: string;
  colors: string[];
  types: string[];
  rarities: string[];
  set: string;
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  colors: [],
  types: [],
  rarities: [],
  set: '',
};
