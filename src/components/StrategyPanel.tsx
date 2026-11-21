import { useEffect, useState } from 'react';
import type { DeckStrategy } from '../strategy';

export function StrategyPanel({
  strategy,
  editable = false,
  onDraft,
  onNotes,
  onRegenerate,
}: {
  strategy: DeckStrategy;
  editable?: boolean;
  onDraft?: (notes: string) => void;
  onNotes?: (notes: string) => void;
  onRegenerate?: () => void;
}) {
  const overview = strategy.notes?.trim() || strategy.overview;
  const [draft, setDraft] = useState(strategy.notes ?? '');
  useEffect(() => setDraft(strategy.notes ?? ''), [strategy.notes, strategy.overview, strategy.archetype]);
  return (
    <details className="strategy" open data-strategy={strategy.archetype}>
      <summary>Strategy · {strategy.archetype}</summary>
      <p data-strategy-overview>{overview}</p>
      <h3>Game plan</h3>
      <p><strong>Early.</strong> {strategy.early}</p>
      <p><strong>Mid.</strong> {strategy.mid}</p>
      <p><strong>Late.</strong> {strategy.late}</p>
      <h3>Key synergies</h3>
      <ul>
        {strategy.synergies.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <h3>Win conditions</h3>
      <ul>
        {strategy.wins.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <h3>Mulligan</h3>
      <p>{strategy.mulligan}</p>
      <h3>Strengths and weaknesses</h3>
      <p>{strategy.strengths}</p>
      <p>{strategy.weaknesses}</p>
      <p>{strategy.playAround}</p>
      <p className="hint">{strategy.bracketNote}</p>
      {editable && (
        <label className="field">
          Your notes
          <textarea
            aria-label="Strategy notes"
            rows={4}
            value={draft}
            placeholder="Optional. Saved notes replace the overview above."
            onChange={(event) => {
              setDraft(event.target.value);
              onDraft?.(event.target.value);
            }}
            onBlur={(event) => onNotes?.(event.target.value)}
          />
        </label>
      )}
      {onRegenerate && <button type="button" className="btn" onClick={onRegenerate}>Regenerate description</button>}
    </details>
  );
}
