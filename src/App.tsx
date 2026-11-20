import { useEffect, useRef, useState } from 'react';
import { AddCard } from './components/AddCard';
import { BackupDialog } from './components/BackupDialog';
import { CardDetail } from './components/CardDetail';
import { CollectionBrowser } from './components/CollectionBrowser';
import { Stats } from './components/Stats';
import { mergeIntoCollection } from './collection';
import { fetchCollection } from './scryfall';
import { updateEntryFromCard } from './cards';
import { loadCollection, saveCollection } from './storage';
import { countNoun, finishLabel } from './format';
import { EMPTY_FILTERS, type CollectionEntry, type Filters, type SortKey, type ViewMode } from './types';

interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

export function App() {
  const saved = useRef(loadCollection());
  const warned = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const [entries, setEntries] = useState<CollectionEntry[]>(saved.current.entries);
  const [view, setView] = useState<ViewMode>(saved.current.view);
  const [sort, setSort] = useState<SortKey>(saved.current.sort);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<number | null>(saved.current.pricesUpdatedAt);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [toast, setToast] = useState<Toast | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLabel, setRefreshLabel] = useState<string | null>(null);

  useEffect(() => {
    const error = saveCollection({ version: 1, entries, pricesUpdatedAt, view, sort });
    if (error && !warned.current) {
      warned.current = true;
      showToast('Could not save on this device. Export a backup so you do not lose cards.');
    }
  }, [entries, pricesUpdatedAt, view, sort]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  function showToast(text: string, action?: Toast['action']) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, action });
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 7000 : 3600);
  }

  function addEntry(entry: CollectionEntry) {
    const previous = entries.find((item) => item.id === entry.id)?.quantity ?? 0;
    setEntries((current) => mergeIntoCollection(current, [entry]));
    const total = previous + entry.quantity;
    showToast(previous > 0 ? `Updated ${entry.name} to ${total}` : `Added ${entry.quantity}× ${entry.name} (${finishLabel(entry.finish)})`);
  }

  function setQuantity(id: string, quantity: number) {
    const next = Math.floor(quantity);
    if (!Number.isFinite(next) || next < 1) return;
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, quantity: Math.min(9999, next) } : entry)));
  }

  function removeEntry(id: string) {
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const removed = entries[index];
    setEntries(entries.filter((entry) => entry.id !== id));
    showToast(`Removed ${removed.quantity}× ${removed.name}`, {
      label: 'Undo',
      run: () => {
        setEntries((current) => {
          if (current.some((entry) => entry.id === removed.id)) return current;
          const next = current.slice();
          next.splice(Math.min(index, next.length), 0, removed);
          return next;
        });
      },
    });
  }

  async function refreshPrices() {
    if (refreshing || entries.length === 0) return;
    setRefreshing(true);
    setRefreshLabel('Updating prices…');
    try {
      const identifiers = [...new Set(entries.map((entry) => entry.scryfallId))].map((id) => ({ id }));
      const { cards, notFound } = await fetchCollection(identifiers, (done, total) => {
        setRefreshLabel(`Updating ${done} / ${total}`);
      });
      if (cards.length === 0) {
        showToast('Scryfall did not return any of these cards.');
        return;
      }
      const byId = new Map(cards.map((card) => [card.id, card]));
      setEntries((current) => current.map((entry) => {
        const card = byId.get(entry.scryfallId);
        return card ? updateEntryFromCard(entry, card) : entry;
      }));
      setPricesUpdatedAt(Date.now());
      showToast(notFound.length > 0 ? `Prices updated. ${notFound.length} cards were not found.` : 'Prices updated from Scryfall.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not refresh prices.');
    } finally {
      setRefreshing(false);
      setRefreshLabel(null);
    }
  }

  const detail = entries.find((entry) => entry.id === detailId) ?? null;

  return (
    <>
      <a className="skip" href="#collection">Skip to collection</a>
      <header className="site-header">
        <div className="brand">
          <p className="eyebrow">Magic: The Gathering</p>
          <h1>
            Card <span>binder</span>
          </h1>
          <p className="tagline">Your collection, saved in this browser.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn" onClick={() => void refreshPrices()} disabled={refreshing || entries.length === 0}>
            {refreshLabel ?? 'Refresh prices'}
          </button>
          <button type="button" className="btn primary" onClick={() => setBackupOpen(true)}>
            Backup
          </button>
        </div>
      </header>

      <main>
        <AddCard entries={entries} onAdd={addEntry} />
        <Stats
          entries={entries}
          pricesUpdatedAt={pricesUpdatedAt}
          activeSet={filters.set}
          onToggleSet={(set) => setFilters((current) => ({ ...current, set: current.set === set ? '' : set }))}
        />
        <CollectionBrowser
          entries={entries}
          view={view}
          sort={sort}
          filters={filters}
          onView={setView}
          onSort={setSort}
          onFilters={setFilters}
          onQuantity={setQuantity}
          onRemove={removeEntry}
          onOpen={setDetailId}
        />
      </main>

      <footer className="site-footer">
        <p>
          Card names, images, and prices come from <a href="https://scryfall.com" target="_blank" rel="noreferrer">Scryfall</a>.
          This site is not affiliated with, endorsed, or sponsored by Scryfall or Wizards of the Coast.
          Requests are paced to follow <a href="https://scryfall.com/docs/api" target="_blank" rel="noreferrer">Scryfall’s rate limits</a>.
        </p>
        <p>
          This website is unofficial Fan Content permitted under the{' '}
          <a href="https://company.wizards.com/en/legal/fancontentpolicy" target="_blank" rel="noreferrer">Fan Content Policy</a>.
          Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
        </p>
        <p>Your collection is saved in this browser only. Use Backup to export it or move it to another device.</p>
      </footer>

      <div className="toast-wrap" aria-live="polite">
        {toast && (
          <div className="toast" role="status">
            <span>{toast.text}</span>
            {toast.action && (
              <button type="button" className="btn" onClick={() => { toast.action?.run(); setToast(null); }}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>

      {backupOpen && (
        <BackupDialog
          entries={entries}
          pricesUpdatedAt={pricesUpdatedAt}
          onClose={() => setBackupOpen(false)}
          onClear={() => {
            setEntries([]);
            setDetailId(null);
            setFilters(EMPTY_FILTERS);
            showToast('Collection cleared.');
          }}
          onApply={(incoming, mode, nextPrices) => {
            setEntries((current) => (mode === 'replace' ? incoming : mergeIntoCollection(current, incoming)));
            if (mode === 'replace' && nextPrices !== undefined) setPricesUpdatedAt(nextPrices);
            const cards = incoming.reduce((sum, entry) => sum + entry.quantity, 0);
            showToast(mode === 'replace' ? `Imported ${countNoun(cards, 'card')}` : `Added ${countNoun(cards, 'card')}`);
            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            document.getElementById('collection')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
          }}
        />
      )}

      {detail && (
        <CardDetail
          entry={detail}
          onClose={() => setDetailId(null)}
          onQuantity={setQuantity}
          onRemove={removeEntry}
        />
      )}
    </>
  );
}
