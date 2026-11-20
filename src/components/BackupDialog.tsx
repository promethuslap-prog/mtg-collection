import { useEffect, useRef, useState } from 'react';
import { combineEntries } from '../collection';
import { groupDeckLines, parseDecklist } from '../decklist';
import { downloadText, exportFilename, parseCollectionCsv, parseCollectionJson, serializeCollection, serializeCsv } from '../io';
import { resolveDecklist } from '../resolve';
import { countNoun } from '../format';
import type { CollectionEntry } from '../types';
import { Modal } from './Modal';

interface BackupDialogProps {
  entries: CollectionEntry[];
  pricesUpdatedAt: number | null;
  onClose: () => void;
  onApply: (entries: CollectionEntry[], mode: 'merge' | 'replace', pricesUpdatedAt?: number | null) => void;
  onClear: () => void;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'choose'; entries: CollectionEntry[]; note: string | null; pricesUpdatedAt: number | null }
  | { kind: 'working'; message: string }
  | { kind: 'done'; message: string; problems: string[] };

export function BackupDialog({ entries, pricesUpdatedAt, onClose, onApply, onClear }: BackupDialogProps) {
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [deckText, setDeckText] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [clearArmed, setClearArmed] = useState(false);
  const parsed = parseDecklist(deckText);
  const grouped = parsed.error ? [] : groupDeckLines(parsed.lines);
  const deckCards = grouped.reduce((sum, group) => sum + group.quantity, 0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  function apply(next: CollectionEntry[], mode: 'merge' | 'replace', nextPrices?: number | null, problems: string[] = []) {
    const combined = combineEntries(next);
    onApply(combined, mode, nextPrices);
    const cards = combined.reduce((sum, entry) => sum + entry.quantity, 0);
    setStage({
      kind: 'done',
      message: mode === 'replace' ? `Replaced this browser’s collection with ${countNoun(cards, 'card')}.` : `Added ${countNoun(cards, 'card')}.`,
      problems,
    });
  }

  async function onFile(file: File) {
    if (file.size > 5_000_000) {
      setStage({ kind: 'done', message: 'That file is larger than 5 MB.', problems: [] });
      return;
    }
    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[');
    if (isJson) {
      const result = parseCollectionJson(text);
      if (result.entries.length === 0) {
        setStage({ kind: 'done', message: result.error ?? 'Nothing to import.', problems: [] });
        return;
      }
      if (entries.length === 0) {
        apply(result.entries, 'replace', result.pricesUpdatedAt, result.error ? [result.error] : []);
        return;
      }
      setStage({ kind: 'choose', entries: result.entries, note: result.error, pricesUpdatedAt: result.pricesUpdatedAt });
      return;
    }
    const result = parseCollectionCsv(text);
    if (result.entries.length === 0) {
      setStage({ kind: 'done', message: result.error ?? 'Nothing to import.', problems: [] });
      return;
    }
    if (entries.length === 0) {
      apply(result.entries, 'replace', null, result.error ? [result.error] : []);
      return;
    }
    setStage({ kind: 'choose', entries: result.entries, note: result.error, pricesUpdatedAt: null });
  }

  async function importDeck() {
    if (parsed.error || parsed.lines.length === 0) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStage({ kind: 'working', message: 'Looking up cards on Scryfall…' });
    try {
      const result = await resolveDecklist(parsed.lines, (done, total) => {
        if (mounted.current) setStage({ kind: 'working', message: `Looking up cards on Scryfall… ${done} of ${total}` });
      }, controller.signal);
      if (!mounted.current) return;
      if (result.entries.length === 0) {
        setStage({
          kind: 'done',
          message: 'None of those cards were found on Scryfall.',
          problems: result.missing.map((miss) => `Line ${miss.lineNumbers.join(', ')}: ${miss.name}`),
        });
        return;
      }
      const problems = [
        ...result.missing.map((miss) => `Line ${miss.lineNumbers.join(', ')}: ${miss.name}`),
        ...result.warnings,
      ];
      apply(result.entries, 'merge', undefined, problems);
      setDeckText('');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (!mounted.current) return;
      setStage({ kind: 'done', message: error instanceof Error ? error.message : 'Import failed.', problems: [] });
    }
  }

  const choiceCount = stage.kind === 'choose' ? stage.entries.reduce((sum, entry) => sum + entry.quantity, 0) : 0;

  return (
    <Modal title="Backup" className="wide" onClose={onClose}>
      <div className="backup-grid">
        <section>
          <h3>Download a backup</h3>
          <p className="hint">JSON keeps the full collection. CSV opens in a spreadsheet.</p>
          <div className="row-actions">
            <button
              type="button"
              className="btn primary"
              disabled={entries.length === 0}
              onClick={() => downloadText(exportFilename('json'), serializeCollection(entries, pricesUpdatedAt), 'application/json')}
            >
              Export JSON
            </button>
            <button
              type="button"
              className="btn"
              disabled={entries.length === 0}
              onClick={() => downloadText(exportFilename('csv'), serializeCsv(entries), 'text/csv')}
            >
              Export CSV
            </button>
          </div>
        </section>

        <section>
          <h3>Import a file</h3>
          <label className="file-btn">
            Choose JSON or CSV
            <input
              type="file"
              accept="application/json,text/csv,.json,.csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void onFile(file);
              }}
            />
          </label>
          {stage.kind === 'choose' && (
            <div className="choice">
              <p>
                This file has {countNoun(choiceCount, 'card')} across {countNoun(stage.entries.length, 'printing')}.
              </p>
              {stage.note && <p className="hint">{stage.note}</p>}
              <div className="row-actions">
                <button type="button" className="btn primary" onClick={() => apply(stage.entries, 'merge', undefined)}>
                  Add to my collection
                </button>
                <button type="button" className="btn danger" onClick={() => apply(stage.entries, 'replace', stage.pricesUpdatedAt)}>
                  Replace my collection
                </button>
              </div>
            </div>
          )}
        </section>

        <section>
          <h3>Paste a decklist</h3>
          <p className="hint">One card per line, like <code>4 Lightning Bolt</code> or <code>1 Sol Ring (C21) 263 *F*</code>. Lines without a set use Scryfall’s newest printing.</p>
          <textarea
            value={deckText}
            placeholder={'4 Lightning Bolt\n1 Sol Ring (C21) 263\n1 Teferi, Hero of Dominaria (DOM) 207 *F*'}
            onChange={(event) => setDeckText(event.target.value)}
            rows={7}
            spellCheck={false}
          />
          {parsed.error && <p role="alert">{parsed.error}</p>}
          {!parsed.error && grouped.length > 0 && (
            <p className="hint">
              Ready to add {countNoun(deckCards, 'card')} ({countNoun(grouped.length, 'line')}).
            </p>
          )}
          <button type="button" className="btn primary" disabled={Boolean(parsed.error) || grouped.length === 0 || stage.kind === 'working'} onClick={() => void importDeck()}>
            Add these cards
          </button>
        </section>

        <section>
          <h3>Clear this browser</h3>
          <p className="hint">This deletes the cards saved on this device. Export a backup first if you want to keep them.</p>
          {clearArmed ? (
            <div className="row-actions">
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  onClear();
                  setClearArmed(false);
                  setStage({ kind: 'done', message: 'Collection cleared on this device.', problems: [] });
                }}
              >
                Yes, delete all cards
              </button>
              <button type="button" className="btn" onClick={() => setClearArmed(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn danger" disabled={entries.length === 0} onClick={() => setClearArmed(true)}>
              Clear collection
            </button>
          )}
        </section>
      </div>

      {stage.kind === 'working' && <p role="status">{stage.message}</p>}
      {stage.kind === 'done' && (
        <div className="import-result" role="status">
          <p>{stage.message}</p>
          {stage.problems.length > 0 && (
            <ul>
              {stage.problems.slice(0, 8).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
              {stage.problems.length > 8 && <li>And {stage.problems.length - 8} more.</li>}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
