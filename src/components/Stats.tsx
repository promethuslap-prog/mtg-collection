import { summarize } from '../collection';
import { formatUsd, formatWhen } from '../format';
import type { CollectionEntry } from '../types';

interface StatsProps {
  entries: CollectionEntry[];
  pricesUpdatedAt: number | null;
  activeSet: string;
  onToggleSet: (set: string) => void;
}

export function Stats({ entries, pricesUpdatedAt, activeSet, onToggleSet }: StatsProps) {
  if (entries.length === 0) return null;
  const summary = summarize(entries);
  const total = summary.colors.reduce((sum, color) => sum + color.count, 0);
  const visibleSets = summary.sets.slice(0, 8);
  const hiddenSets = summary.sets.length - visibleSets.length;

  return (
    <section className="stats" aria-label="Collection summary">
      <div className="stat-row">
        <article>
          <p className="stat-label">Cards</p>
          <p className="stat-value">{summary.totalCards.toLocaleString('en-US')}</p>
        </article>
        <article>
          <p className="stat-label">Unique cards</p>
          <p className="stat-value">{summary.uniqueCards.toLocaleString('en-US')}</p>
          {summary.printings !== summary.uniqueCards && (
            <p className="stat-note">{summary.printings.toLocaleString('en-US')} printings</p>
          )}
        </article>
        <article>
          <p className="stat-label">Estimated value</p>
          <p className="stat-value">{formatUsd(summary.value)}</p>
          {summary.missingPrices > 0 && (
            <p className="stat-note">{summary.missingPrices.toLocaleString('en-US')} unpriced</p>
          )}
        </article>
      </div>

      {summary.colors.length > 0 && (
        <div className="breakdown">
          <h2>By color</h2>
          <div
            className="bar"
            role="img"
            aria-label={summary.colors.map((color) => `${color.label} ${color.count}`).join(', ')}
          >
            {summary.colors.map((color) => (
              <span
                key={color.key}
                className={`bar-seg bar-${color.key}`}
                style={{ width: `${total ? (color.count / total) * 100 : 0}%` }}
              />
            ))}
          </div>
          <ul className="legend">
            {summary.colors.map((color) => (
              <li key={color.key}>
                <span className={`swatch bar-${color.key}`} aria-hidden="true" />
                {color.label}
                <strong>{color.count.toLocaleString('en-US')}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.sets.length > 0 && (
        <div className="breakdown">
          <h2>By set</h2>
          <div className="set-list">
            {visibleSets.map((set) => (
              <button
                key={set.set || 'unknown'}
                type="button"
                className="chip"
                aria-pressed={activeSet === set.set}
                title={set.setName}
                onClick={() => onToggleSet(set.set)}
              >
                {(set.set || '—').toUpperCase()} · {set.count.toLocaleString('en-US')}
              </button>
            ))}
            {hiddenSets > 0 && <span className="hint">{hiddenSets} more sets in the filter</span>}
          </div>
        </div>
      )}

      <p className="hint">
        Estimated from Scryfall USD market prices
        {summary.missingPrices > 0 ? '. Cards without a price are left out of the total' : ''}.{' '}
        {pricesUpdatedAt ? `All prices refreshed ${formatWhen(pricesUpdatedAt)}.` : 'Prices were saved when each card was added. Refresh to update them all.'}
      </p>
    </section>
  );
}
