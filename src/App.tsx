import { useEffect, useRef, useState } from 'react';
import { AddCard } from './components/AddCard';
import { DecksSection } from './components/Decks';
import { BackupDialog } from './components/BackupDialog';
import { CardDetail } from './components/CardDetail';
import { CollectionBrowser } from './components/CollectionBrowser';
import { Stats } from './components/Stats';
import { mergeIntoCollection } from './collection';
import { fetchCollection } from './scryfall';
import { entryKey, updateEntryFromCard } from './cards';
import { loadPurchaseFile, resolvePurchaseOrders } from './importPurchases';
import { layerChangeNote, manualEntriesAfterImport } from './layers';
import { syncDerivedLayers } from './syncLayers';
import { loadBinder, saveBinder } from './storage';
import { countNoun, finishLabel, formatSyncDate } from './format';
import { EMPTY_FILTERS, type CollectionEntry, type Filters, type SortKey, type ViewMode } from './types';

interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

export function App() {
  const saved = useRef(loadBinder());
  const warned = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const syncLock = useRef<Promise<void> | null>(null);
  const booted = useRef(false);
  const migrationDone = useRef(saved.current.migrationDone);
  const [manualEntries, setManualEntries] = useState<CollectionEntry[]>(saved.current.migrationDone ? saved.current.manualEntries : saved.current.legacyEntries);
  const [moxfieldEntries, setMoxfieldEntries] = useState<CollectionEntry[]>(saved.current.layerMoxfield);
  const [tcgplayerEntries, setTcgplayerEntries] = useState<CollectionEntry[]>(saved.current.layerTcgplayer);
  const [purchaseCache, setPurchaseCache] = useState<CollectionEntry[]>(saved.current.layerPurchases);
  const [moxfieldUpdatedAt, setMoxfieldUpdatedAt] = useState<string | null>(saved.current.moxfieldUpdatedAt);
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'done'>(saved.current.migrationDone ? 'idle' : 'loading');
  const [view, setView] = useState<ViewMode>(saved.current.view);
  const [sort, setSort] = useState<SortKey>(saved.current.sort);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<number | null>(saved.current.pricesUpdatedAt);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [toast, setToast] = useState<Toast | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [section, setSection] = useState<'collection' | 'decks'>('collection');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLabel, setRefreshLabel] = useState<string | null>(null);
  const entries = [...manualEntries, ...moxfieldEntries, ...tcgplayerEntries];
  const entriesRef = useRef(entries);
  const manualRef = useRef(manualEntries);
  const moxfieldRef = useRef(moxfieldEntries);
  const tcgRef = useRef(tcgplayerEntries);
  const purchaseCacheRef = useRef(purchaseCache);
  entriesRef.current = entries;
  manualRef.current = manualEntries;
  moxfieldRef.current = moxfieldEntries;
  tcgRef.current = tcgplayerEntries;
  purchaseCacheRef.current = purchaseCache;

  useEffect(() => {
    if (!booted.current) return;
    const error = saveBinder({
      version: 1,
      model: 2,
      manualEntries,
      layerMoxfield: moxfieldEntries,
      layerTcgplayer: tcgplayerEntries,
      layerPurchases: purchaseCache,
      moxfieldUpdatedAt,
      pricesUpdatedAt,
      view,
      sort,
      migrationDone: true,
    });
    if (error && !warned.current) {
      warned.current = true;
      showToast('Could not save on this device. Export a backup so you do not lose cards.');
    }
  }, [manualEntries, moxfieldEntries, tcgplayerEntries, purchaseCache, moxfieldUpdatedAt, pricesUpdatedAt, view, sort]);

  useEffect(() => {
    void syncLayers(false);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  function showToast(text: string, action?: Toast['action']) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, action });
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 7000 : 3600);
  }

  function addEntry(entry: CollectionEntry) {
    const manual = { ...entry, source: 'manual' as const, id: entryKey(entry.scryfallId, entry.finish) };
    delete manual.fromTcgplayer;
    const previous = manualRef.current.find((item) => item.id === manual.id)?.quantity ?? 0;
    const next = mergeIntoCollection(manualRef.current, [manual]);
    manualRef.current = next;
    setManualEntries(next);
    const total = previous + manual.quantity;
    showToast(previous > 0 ? `Updated ${manual.name} to ${total}` : `Added ${manual.quantity}× ${manual.name} (${finishLabel(manual.finish)})`);
  }

  function setQuantity(id: string, quantity: number) {
    const next = Math.floor(quantity);
    if (!Number.isFinite(next) || next < 1) return;
    if (!manualRef.current.some((entry) => entry.id === id)) return;
    const updated = manualRef.current.map((entry) => (entry.id === id ? { ...entry, quantity: Math.min(9999, next) } : entry));
    manualRef.current = updated;
    setManualEntries(updated);
  }

  function removeEntry(id: string) {
    const index = manualRef.current.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const removed = manualRef.current[index];
    const updated = manualRef.current.filter((entry) => entry.id !== id);
    manualRef.current = updated;
    setManualEntries(updated);
    showToast(`Removed ${removed.quantity}× ${removed.name}`, {
      label: 'Undo',
      run: () => {
        setManualEntries((current) => {
          if (current.some((entry) => entry.id === removed.id)) return current;
          const next = current.slice();
          next.splice(Math.min(index, next.length), 0, removed);
          manualRef.current = next;
          return next;
        });
      },
    });
  }

  async function migrateManual(): Promise<{ entries: CollectionEntry[]; skipTcgplayer: boolean }> {
    const initial = saved.current;
    if (migrationDone.current) return { entries: manualRef.current, skipTcgplayer: false };
    const asManual = (list: CollectionEntry[]) => list.map((entry) => {
      const next = { ...entry, source: 'manual' as const, id: entryKey(entry.scryfallId, entry.finish) };
      delete next.fromTcgplayer;
      return next;
    });
    if (initial.importedOrderIds.length === 0) {
      migrationDone.current = true;
      return { entries: asManual(initial.legacyEntries.filter((entry) => !entry.fromTcgplayer)), skipTcgplayer: false };
    }
    const purchases = await loadPurchaseFile();
    if (!purchases) return { entries: asManual(initial.legacyEntries), skipTcgplayer: true };
    const resolved = await resolvePurchaseOrders(purchases.orders.filter((order) => initial.importedOrderIds.includes(order.id)));
    migrationDone.current = true;
    return { entries: manualEntriesAfterImport(initial.legacyEntries, resolved.entries), skipTcgplayer: false };
  }

  async function syncLayers(announceErrors: boolean) {
    if (syncLock.current) return syncLock.current;
    const run = (async () => {
      setSyncState('loading');
      try {
        const manual = await migrateManual();
        manualRef.current = manual.entries;
        setManualEntries(manual.entries);
        const synced = await syncDerivedLayers({ moxfield: moxfieldRef.current, purchases: purchaseCacheRef.current });
        if (!synced) {
          setSyncState('done');
          booted.current = true;
          return;
        }
        const nextTcgplayer = manual.skipTcgplayer ? tcgRef.current : synced.tcgplayer;
        const note = layerChangeNote(moxfieldRef.current, synced.moxfield, tcgRef.current, nextTcgplayer);
        moxfieldRef.current = synced.moxfield;
        tcgRef.current = nextTcgplayer;
        purchaseCacheRef.current = synced.purchases;
        setMoxfieldEntries(synced.moxfield);
        setTcgplayerEntries(nextTcgplayer);
        setPurchaseCache(synced.purchases);
        setMoxfieldUpdatedAt(synced.updatedAt);
        if (note) showToast(note);
        setSyncState('done');
        booted.current = true;
      } catch (error) {
        setSyncState('done');
        booted.current = true;
        if (announceErrors) showToast(error instanceof Error ? error.message : 'Could not sync Moxfield.');
        else console.warn(error);
      }
    })();
    syncLock.current = run.finally(() => {
      syncLock.current = null;
    });
    return syncLock.current;
  }

  async function refreshPrices(source: CollectionEntry[]) {
    if (source.length === 0) return;
    setRefreshLabel('Updating prices…');
    const identifiers = [...new Set(source.map((entry) => entry.scryfallId))].map((id) => ({ id }));
    const { cards, notFound } = await fetchCollection(identifiers, (done, total) => {
      setRefreshLabel(`Updating ${done} / ${total}`);
    });
    if (cards.length === 0) {
      showToast('Scryfall did not return any of these cards.');
      return;
    }
    const byId = new Map(cards.map((card) => [card.id, card]));
    const apply = (list: CollectionEntry[]) => list.map((entry) => {
      const card = byId.get(entry.scryfallId);
      return card ? updateEntryFromCard(entry, card) : entry;
    });
    const nextManual = apply(manualRef.current);
    const nextMoxfield = apply(moxfieldRef.current);
    const nextTcg = apply(tcgRef.current);
    manualRef.current = nextManual;
    moxfieldRef.current = nextMoxfield;
    tcgRef.current = nextTcg;
    setManualEntries(nextManual);
    setMoxfieldEntries(nextMoxfield);
    setTcgplayerEntries(nextTcg);
    setPricesUpdatedAt(Date.now());
    showToast(notFound.length > 0 ? `Prices updated. ${notFound.length} cards were not found.` : 'Prices updated from Scryfall.');
  }

  async function refreshAll() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshLabel('Syncing Moxfield…');
    try {
      await syncLayers(true);
      await refreshPrices(entriesRef.current);
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
          {moxfieldUpdatedAt && (
            <p className="sync-line" data-sync={syncState}>Synced from Moxfield · {formatSyncDate(moxfieldUpdatedAt)}</p>
          )}
        </div>
        <div className="header-actions">
          <nav className="section-nav" aria-label="Sections">
            <button type="button" className="btn" aria-pressed={section === 'collection'} onClick={() => setSection('collection')}>Collection</button>
            <button type="button" className="btn" aria-pressed={section === 'decks'} onClick={() => setSection('decks')}>Decks</button>
          </nav>
          <button type="button" className="btn" onClick={() => void refreshAll()} disabled={refreshing}>
            {refreshLabel ?? 'Refresh'}
          </button>
          <button type="button" className="btn primary" onClick={() => setBackupOpen(true)}>
            Backup
          </button>
        </div>
      </header>

      <main>
        {section === 'decks' ? <DecksSection entries={entries} /> : <>
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
        </>}
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
            manualRef.current = [];
            setManualEntries([]);
            setDetailId(null);
            setFilters(EMPTY_FILTERS);
            showToast('Cards you added on this device were cleared. Moxfield stays in sync.');
          }}
          onApply={(incoming, mode, nextPrices) => {
            const manualIncoming = incoming
              .filter((entry) => (entry.source ?? (entry.fromTcgplayer ? 'tcgplayer' : 'manual')) === 'manual')
              .map((entry) => ({ ...entry, source: 'manual' as const, id: entryKey(entry.scryfallId, entry.finish) }));
            const next = mode === 'replace' ? manualIncoming : mergeIntoCollection(manualRef.current, manualIncoming);
            manualRef.current = next;
            setManualEntries(next);
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
