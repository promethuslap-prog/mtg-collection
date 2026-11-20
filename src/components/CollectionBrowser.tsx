import { useMemo, useState } from 'react';
import { COLOR_FILTERS, SORTS, TYPE_FILTERS, filterEntries, sortEntries } from '../collection';
import { priceLabel, rarityLabel } from '../format';
import type { CollectionEntry, Filters, SortKey, ViewMode } from '../types';
import { CardImage, Pips, rarityClass } from './bits';
import { Quantity } from './Quantity';

interface CollectionBrowserProps {
  entries: CollectionEntry[];
  view: ViewMode;
  sort: SortKey;
  filters: Filters;
  onView: (view: ViewMode) => void;
  onSort: (sort: SortKey) => void;
  onFilters: (filters: Filters) => void;
  onQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function CollectionBrowser({
  entries,
  view,
  sort,
  filters,
  onView,
  onSort,
  onFilters,
  onQuantity,
  onRemove,
  onOpen,
}: CollectionBrowserProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sets = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) map.set(entry.set, entry.setName || entry.set.toUpperCase());
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);
  const rarities = useMemo(() => {
    const present = new Set(entries.map((entry) => entry.rarity));
    const base = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'].filter((rarity) => present.has(rarity));
    for (const rarity of present) {
      if (!base.includes(rarity)) base.push(rarity);
    }
    return base;
  }, [entries]);
  const visible = useMemo(() => sortEntries(filterEntries(entries, filters), sort), [entries, filters, sort]);
  const facetCount = filters.colors.length + filters.types.length + filters.rarities.length + (filters.set ? 1 : 0);

  if (entries.length === 0) {
    return (
      <section id="collection" className="empty">
        <h2>Your binder is empty</h2>
        <p>Search for a card above to add your first one, or paste a decklist from Backup.</p>
      </section>
    );
  }

  return (
    <section id="collection" className="browser" aria-label="Your collection">
      <div className="toolbar">
        <label className="field grow">
          Search your collection
          <input
            value={filters.query}
            placeholder="Name, type, set, or collector number"
            onChange={(event) => onFilters({ ...filters, query: event.target.value })}
          />
        </label>
        <label className="field">
          Sort
          <select value={sort} onChange={(event) => onSort(event.target.value as SortKey)}>
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="view-toggle" role="group" aria-label="Layout">
          <button type="button" className="btn" aria-pressed={view === 'grid'} onClick={() => onView('grid')}>
            Grid
          </button>
          <button type="button" className="btn" aria-pressed={view === 'list'} onClick={() => onView('list')}>
            List
          </button>
        </div>
        <button type="button" className="btn filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          Filters{facetCount > 0 ? ` (${facetCount})` : ''}
        </button>
      </div>

      <div className={filtersOpen ? 'filters open' : 'filters'}>
        <fieldset>
          <legend>Color</legend>
          <div className="chip-row">
            {COLOR_FILTERS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`chip chip-${color.id}`}
                aria-pressed={filters.colors.includes(color.id)}
                onClick={() => onFilters({ ...filters, colors: toggle(filters.colors, color.id) })}
              >
                {color.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Type</legend>
          <div className="chip-row">
            {TYPE_FILTERS.map((type) => (
              <button
                key={type.id}
                type="button"
                className="chip"
                aria-pressed={filters.types.includes(type.id)}
                onClick={() => onFilters({ ...filters, types: toggle(filters.types, type.id) })}
              >
                {type.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Rarity</legend>
          <div className="chip-row">
            {rarities.map((rarity) => (
              <button
                key={rarity}
                type="button"
                className="chip"
                aria-pressed={filters.rarities.includes(rarity)}
                onClick={() => onFilters({ ...filters, rarities: toggle(filters.rarities, rarity) })}
              >
                {rarityLabel(rarity)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field set-field">
          Set
          <select value={filters.set} onChange={(event) => onFilters({ ...filters, set: event.target.value })}>
            <option value="">All sets</option>
            {sets.map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
        {facetCount > 0 && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => onFilters({ ...filters, colors: [], types: [], rarities: [], set: '' })}
          >
            Clear filters
          </button>
        )}
        <p className="hint">A card is shown if it matches any selected color, type, or rarity.</p>
      </div>

      <p className="result-count" aria-live="polite">
        Showing {visible.length.toLocaleString('en-US')} of {entries.length.toLocaleString('en-US')} printings
      </p>

      {visible.length === 0 ? (
        <div className="empty compact">
          <h2>No cards match</h2>
          <p>Try a different search or clear the filters.</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid">
          {visible.map((entry) => (
            <article key={entry.id} className="tile">
              <button type="button" className="tile-open" onClick={() => onOpen(entry.id)}>
                <CardImage src={entry.image} alt={`${entry.name} (${entry.set.toUpperCase()} #${entry.collectorNumber})`} />
                <span className="tile-name">{entry.name}</span>
                <span className="tile-meta">
                  <Pips colors={entry.colorIdentity} />
                  <span>{entry.set.toUpperCase()}</span>
                  <span className={rarityClass(entry.rarity)}>{rarityLabel(entry.rarity)}</span>
                  {entry.finish !== 'nonfoil' && <span className="finish-tag">{entry.finish === 'foil' ? 'Foil' : 'Etched'}</span>}
                </span>
                <span className="tile-price">{priceLabel(entry)}</span>
              </button>
              <div className="tile-actions">
                <Quantity value={entry.quantity} onChange={(quantity) => onQuantity(entry.id, quantity)} label={`${entry.name} quantity`} />
                <button type="button" className="text-btn" onClick={() => onRemove(entry.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="list">
          {visible.map((entry) => (
            <article key={entry.id} className="list-row">
              <button type="button" className="thumb-btn" onClick={() => onOpen(entry.id)} aria-label={`Open ${entry.name}`}>
                <CardImage src={entry.image} alt="" />
              </button>
              <div className="list-copy">
                <button type="button" className="list-name" onClick={() => onOpen(entry.id)}>
                  {entry.name}
                </button>
                <p>
                  <Pips colors={entry.colorIdentity} /> {entry.typeLine}
                </p>
                <p className="muted">
                  {entry.setName || entry.set.toUpperCase()} ({entry.set.toUpperCase()}) #{entry.collectorNumber} ·{' '}
                  <span className={rarityClass(entry.rarity)}>{rarityLabel(entry.rarity)}</span>
                  {entry.finish !== 'nonfoil' ? ` · ${entry.finish === 'foil' ? 'Foil' : 'Etched'}` : ''}
                </p>
              </div>
              <div className="list-side">
                <strong>{priceLabel(entry)}</strong>
                <Quantity value={entry.quantity} onChange={(quantity) => onQuantity(entry.id, quantity)} label={`${entry.name} quantity`} />
                <button type="button" className="text-btn" onClick={() => onRemove(entry.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
