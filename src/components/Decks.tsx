import { useEffect, useState } from 'react';
import { analyzeDeck, combinedIdentity, type DeckReport, type KnownCard } from '../deckAnalyze';
import {
  enrichCollection,
  knownFromCollection,
  knownFromPrinting,
  legalityFor,
  loadDeckFile,
  printingById,
  resolveCommanders,
  resolveLines,
  tagOracleIds,
  tagsFor,
  toKnown,
  upgradeSearch,
  type CachedPrinting,
} from '../deckData';
import { deckSize, formatTarget, isLocalDeck, playingLines, type DeckCardLine, type DeckRecord } from '../deckModel';
import { formatSyncDate, formatUsd } from '../format';
import { downloadText } from '../io';
import { normalizeName } from '../text';
import {
  duplicateDeck,
  loadUserDecks,
  loadUserDecksFromIdb,
  parseUserDeckBackup,
  saveUserDecks,
  serializeUserDecks,
  upsertLine,
} from '../userDecks';
import { Pips } from './bits';
import { DeckBuilder } from './DeckBuilder';
import { DeckEditor, DeckExport, ImportDeckDialog, NewDeckDialog } from './DeckEditor';
import type { CollectionEntry } from '../types';

interface DecksProps {
  entries: CollectionEntry[];
}

export function DecksSection({ entries }: DecksProps) {
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [userDecks, setUserDecks] = useState<DeckRecord[]>(() => loadUserDecks());
  const [commanders, setCommanders] = useState<Record<string, CachedPrinting>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restore, setRestore] = useState<DeckRecord[] | null>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    void loadDeckFile().then((file) => {
      if (!file) {
        setError('Could not read decks.json.');
        return;
      }
      setDecks(file.decks);
      setUpdatedAt(file.updatedAt);
    }).catch((reason) => {
      console.warn(reason);
      setError('Could not load decks.');
    });
  }, []);

  useEffect(() => {
    void loadUserDecksFromIdb().then((stored) => {
      if (stored && stored.length > 0 && loadUserDecks().length === 0) setUserDecks(stored);
    });
  }, []);

  useEffect(() => {
    const names = [...new Set([...decks, ...userDecks].flatMap((deck) => deck.commanders))];
    if (names.length === 0) return undefined;
    let cancel = false;
    void resolveCommanders(names).then((cards) => {
      if (cancel) return;
      const next: Record<string, CachedPrinting> = {};
      for (const card of cards) next[card.name.toLowerCase()] = card;
      setCommanders(next);
    });
    return () => {
      cancel = true;
    };
  }, [decks, userDecks]);

  function persist(next: DeckRecord[]) {
    setUserDecks(next);
    void saveUserDecks(next).then((message) => {
      if (message) setError(message);
    });
  }

  function addLocal(deck: DeckRecord) {
    persist([deck, ...userDecks.filter((item) => item.id !== deck.id)]);
    setOpenId(deck.id);
    setEditing(true);
    setCreating(false);
    setImporting(false);
  }

  const all = [...userDecks, ...decks];
  const open = all.find((deck) => deck.id === openId) ?? null;

  return (
    <div className="decks">
      {building ? (
        <DeckBuilder
          entries={entries}
          decks={all}
          onClose={() => setBuilding(false)}
          onSave={(deck) => { setBuilding(false); addLocal(deck); }}
        />
      ) : open ? (
        <DeckPage
          deck={open}
          entries={entries}
          commanders={commanders}
          decks={all}
          editing={editing && isLocalDeck(open)}
          onEdit={() => setEditing(true)}
          onDone={() => setEditing(false)}
          onBack={() => { setOpenId(null); setEditing(false); }}
          onChange={(deck) => persist(userDecks.map((item) => item.id === deck.id ? deck : item))}
          onDuplicate={() => addLocal(duplicateDeck(open))}
          onDelete={() => {
            persist(userDecks.filter((item) => item.id !== open.id));
            setOpenId(null);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div className="deck-intro">
            <h2>Decks</h2>
            <p className="hint">
              {updatedAt ? `Deck list from Moxfield · ${formatSyncDate(updatedAt)}` : 'Loading decks from Moxfield.'}
              {' '}Decks made here stay in this browser. Moxfield decks stay read-only.
            </p>
          </div>
          <div className="row-actions">
            <button type="button" className="btn primary" onClick={() => setBuilding(true)}>Build a deck for me</button>
            <button type="button" className="btn" onClick={() => setCreating(true)}>New deck</button>
            <button type="button" className="btn" onClick={() => setImporting(true)}>Import</button>
            <button type="button" className="btn" onClick={() => downloadText(`mtg-decks-${new Date().toISOString().slice(0, 10)}.json`, serializeUserDecks(userDecks), 'application/json')}>Back up my decks</button>
            <label className="btn file-btn">
              Restore
              <input
                aria-label="Restore deck backup"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  void file.text().then((text) => {
                    const parsed = parseUserDeckBackup(text);
                    if (parsed.error) {
                      setError(parsed.error);
                      return;
                    }
                    setRestore(parsed.decks);
                  });
                }}
              />
            </label>
          </div>
          {restore && (
            <div className="restore-box" role="status">
              <p>Restore {restore.length} saved {restore.length === 1 ? 'deck' : 'decks'}? This replaces decks made on this device.</p>
              <div className="row-actions">
                <button type="button" className="btn primary" onClick={() => { persist(restore); setRestore(null); }}>Restore decks</button>
                <button type="button" className="btn" onClick={() => setRestore(null)}>Cancel</button>
              </div>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="deck-grid">
            {all.map((deck) => {
              const arts = deck.commanders.map((name) => commanders[name.toLowerCase()]).filter(Boolean);
              const identity = combinedIdentity(arts.map((card) => card.colorIdentity));
              const count = deckSize(deck);
              const target = formatTarget(deck.format);
              const local = isLocalDeck(deck);
              return (
                <article key={deck.id} className="deck-card" data-deck-name={deck.name}>
                  <button type="button" className="deck-open" onClick={() => { setOpenId(deck.id); setEditing(false); }}>
                    <span className="deck-art">
                      {arts[0]?.image ? <img src={arts[0].image} alt="" /> : <span className="fallback">{deck.commanders[0] ?? deck.name}</span>}
                    </span>
                    <span className="deck-copy">
                      <strong>{deck.name}</strong>
                      <span className="origin-tag">{local ? 'Made here' : 'From Moxfield'}</span>
                      <span className="muted">{deck.format} · {count}/{target}</span>
                      <Pips colors={identity} />
                      <span className={`health health-${healthTone(count, target)}`}>Health {quickHealth(count, target)}</span>
                    </span>
                  </button>
                  <div className="deck-card-actions">
                    {local ? (
                      <button type="button" className="btn" aria-label={`Edit ${deck.name}`} onClick={() => { setOpenId(deck.id); setEditing(true); }}>Edit</button>
                    ) : (
                      <button type="button" className="btn" aria-label={`Duplicate ${deck.name}`} onClick={() => addLocal(duplicateDeck(deck))}>Duplicate</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      {creating && <NewDeckDialog onClose={() => setCreating(false)} onCreate={addLocal} />}
      {importing && <ImportDeckDialog onClose={() => setImporting(false)} onCreate={addLocal} />}
    </div>
  );
}

function DeckPage({
  deck,
  entries,
  commanders,
  decks,
  editing,
  onEdit,
  onDone,
  onBack,
  onChange,
  onDuplicate,
  onDelete,
}: {
  deck: DeckRecord;
  entries: CollectionEntry[];
  commanders: Record<string, CachedPrinting>;
  decks: DeckRecord[];
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onBack: () => void;
  onChange: (deck: DeckRecord) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [report, setReport] = useState<DeckReport | null>(null);
  const [budget, setBudget] = useState(5);
  const [status, setStatus] = useState('Reading the deck…');
  const [panel, setPanel] = useState<'add' | 'buy' | 'cut' | 'swap'>('add');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const local = isLocalDeck(deck);

  useEffect(() => {
    let cancel = false;
    setReport(null);
    setStatus('Matching printings on Scryfall…');
    void (async () => {
      const lines = playingLines(deck);
      const printings = await resolveLines(lines);
      const byKey = new Map(printings.map((card) => [`${card.set}|${card.collectorNumber.toLowerCase()}`, card]));
      const byName = new Map(printings.map((card) => [card.name.toLowerCase(), card]));
      const paired = lines.map((line) => {
        const printing = (line.set && line.collectorNumber
          ? byKey.get(`${line.set}|${line.collectorNumber.toLowerCase()}`)
          : undefined) ?? byName.get(line.name.toLowerCase());
        return { line, printing };
      });
      const names = deck.commanders.length > 0 ? deck.commanders : (deck.commanderBoard ?? []).map((line) => line.name);
      const identityCards = names.map((name) => commanders[name.toLowerCase()]).filter(Boolean);
      const resolved = identityCards.length > 0 ? identityCards : await resolveCommanders(names);
      const identity = combinedIdentity(resolved.map((card) => card.colorIdentity));
      const otherDecks = decks.map((item) => ({
        id: item.id,
        name: item.name,
        names: [...playingLines(item), ...item.sideboard, ...(item.maybeboard ?? [])].map((line) => line.name),
      }));
      const build = (upgrades: KnownCard[]) => {
        const known = paired.map((item) => toKnown(item.line, item.printing, item.printing ? tagsFor(item.printing.oracleId) : [], deck.format)).filter((card): card is KnownCard => card !== null);
        const owned = entries.map((entry) => knownFromCollection(entry, deck.format)).filter((card): card is KnownCard => card !== null);
        return analyzeDeck({ deck, cards: known, identity, owned, otherDecks, upgrades, budget: 999 });
      };
      await enrichCollection(entries.map((entry) => entry.scryfallId));
      if (cancel) return;
      setReport(build([]));
      setStatus('');
      const oracleIds = [
        ...paired.map((item) => item.printing?.oracleId ?? ''),
        ...entries.map((entry) => printingById(entry.scryfallId)?.oracleId ?? ''),
      ].filter(Boolean);
      await tagOracleIds(oracleIds);
      if (cancel) return;
      const upgrades = (await upgradeSearch(identity, deck.format)).map((printing) => {
        const card = knownFromPrinting(printing, 1);
        card.legality = legalityFor(printing, deck.format);
        return card;
      });
      if (!cancel) setReport(build(upgrades));
    })().catch((reason) => {
      console.warn(reason);
      if (!cancel) setStatus(reason instanceof Error ? reason.message : 'Could not analyze this deck.');
    });
    return () => {
      cancel = true;
    };
  }, [deck, entries, commanders, decks]);

  const arts = deck.commanders.map((name) => commanders[name.toLowerCase()]).filter(Boolean);

  function addNamed(name: string) {
    if (!local) return;
    const present = playingLines(deck).some((line) => normalizeName(line.name) === normalizeName(name));
    if (present) return;
    const owned = entries.find((entry) => normalizeName(entry.name) === normalizeName(name));
    const line: DeckCardLine = owned
      ? { qty: 1, name: owned.name, set: owned.set, collectorNumber: owned.collectorNumber, foil: owned.finish === 'nonfoil' ? '' : owned.finish }
      : { qty: 1, name, set: '', collectorNumber: '', foil: '' };
    onChange({ ...deck, mainboard: upsertLine(deck.mainboard, line) });
  }

  return (
    <article className="deck-page" data-deck-page={deck.name}>
      <div className="row-actions">
        <button type="button" className="btn" onClick={onBack}>All decks</button>
        {local && !editing && <button type="button" className="btn" onClick={onEdit}>Edit deck</button>}
        {!local && <button type="button" className="btn" onClick={onDuplicate}>Duplicate</button>}
        {local && !confirmDelete && <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>Delete</button>}
        {confirmDelete && (
          <>
            <span>Delete {deck.name} from this device?</span>
            <button type="button" className="btn" onClick={onDelete}>Delete deck</button>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </>
        )}
      </div>
      <header className="deck-hero">
        <div className="deck-hero-art">
          {arts.map((card) => <img key={card.id} src={card.image} alt={card.name} />)}
        </div>
        <div>
          <p className="eyebrow">{local ? 'Made here' : 'From Moxfield'} · {deck.format}</p>
          <h2>{deck.name}</h2>
          <Pips colors={combinedIdentity(arts.map((card) => card.colorIdentity))} />
          {!local && <p className="hint">This deck comes from Moxfield and stays read-only here. Edit it on Moxfield, or duplicate it to change a copy on this device.</p>}
          {deck.url && <p><a href={deck.url} target="_blank" rel="noreferrer">View on Moxfield</a></p>}
          {report && !editing && <p className={`health health-${report.health >= 75 ? 'ok' : 'low'}`}>Health {report.health} · {report.cardCount}/{report.target} cards · avg MV {report.averageMv.toFixed(2)}</p>}
        </div>
      </header>
      {local && !editing && <DeckExport deck={deck} />}
      {editing ? (
        <DeckEditor deck={deck} entries={entries} decks={decks} onChange={onChange} onDone={onDone} />
      ) : (
        <>
          {status && <p role="status">{status}</p>}
          {report && (
            <DeckBody
              report={report}
              budget={budget}
              onBudget={setBudget}
              panel={panel}
              onPanel={setPanel}
              onAdd={local ? addNamed : undefined}
            />
          )}
        </>
      )}
    </article>
  );
}

function DeckBody({
  report,
  budget,
  onBudget,
  panel,
  onPanel,
  onAdd,
}: {
  report: DeckReport;
  budget: number;
  onBudget: (value: number) => void;
  panel: 'add' | 'buy' | 'cut' | 'swap';
  onPanel: (panel: 'add' | 'buy' | 'cut' | 'swap') => void;
  onAdd?: (name: string) => void;
}) {
  const maxCurve = Math.max(1, ...report.curve);
  return (
    <div className="deck-body">
      {report.issues.length > 0 && (
        <ul className="issue-list">
          {report.issues.slice(0, 8).map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      <section className="deck-stats">
        <div>
          <h3>Mana curve</h3>
          <div className="curve" aria-label="Mana curve">
            {report.curve.map((count, cost) => (
              <div key={cost} className="curve-col">
                <span style={{ height: `${Math.max(8, (count / maxCurve) * 88)}px` }} />
                <em>{cost === 6 ? '6+' : cost}</em>
                <small>{count}</small>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>Types</h3>
          <ul className="type-bars">
            {report.types.map((type) => <li key={type.label}><span>{type.label}</span><strong>{type.count}</strong></li>)}
          </ul>
        </div>
        <div>
          <h3>Color pips vs sources</h3>
          <ul className="type-bars">
            {Object.keys(report.pips).map((color) => (
              <li key={color}><span>{color}</span><strong>{report.pips[color]} pips · {report.sources[color]} lands</strong></li>
            ))}
          </ul>
        </div>
      </section>
      <section>
        <h3>Roles</h3>
        <div className="role-list">
          {report.roles.map((role) => (
            <div key={role.id} className="role-row">
              <span>{role.label}</span>
              <span className={`level level-${role.level}`}>{role.level}</span>
              <strong>{role.count}</strong>
              <small>{role.detail}</small>
            </div>
          ))}
        </div>
        <p className="hint">Land target is about {report.landRecommend}, based on the curve{report.roles.find((role) => role.id === 'ramp') ? ' and ramp' : ''}.</p>
      </section>
      <section>
        <div className="row-actions">
          {(['add', 'buy', 'cut', 'swap'] as const).map((item) => (
            <button key={item} type="button" className="btn" aria-pressed={panel === item} onClick={() => onPanel(item)}>
              {item === 'add' ? 'Add' : item === 'buy' ? 'Upgrades' : item === 'cut' ? 'Cut' : 'Swap'}
            </button>
          ))}
          {panel === 'buy' && (
            <label className="field budget">
              Budget
              <input type="number" min={0} step={1} value={budget} onChange={(event) => onBudget(Number(event.target.value) || 0)} />
            </label>
          )}
        </div>
        {panel === 'add' && <SuggestionList items={report.adds} empty="No owned cards fit this deck." onAdd={onAdd} />}
        {panel === 'buy' && <SuggestionList items={report.upgrades.filter((item) => item.price == null || item.price <= budget)} empty="No upgrades under this budget." />}
        {panel === 'cut' && <SuggestionList items={report.cuts} empty="Nothing stands out to cut." />}
        {panel === 'swap' && (
          <ul className="suggest-list">
            {report.swaps.map((swap) => <li key={`${swap.cut}-${swap.add}`}><strong>Cut {swap.cut}</strong> → add {swap.add}. <span className="muted">{swap.reason}</span></li>)}
            {report.swaps.length === 0 && <li>No swap pairs yet.</li>}
          </ul>
        )}
      </section>
      <section>
        <h3>Owned / missing</h3>
        <p className="hint">About {formatUsd(report.missingCost)} to buy the missing cards at Scryfall’s nonfoil price.</p>
        <ul className="suggest-list">
          {report.missing.map((card) => (
            <li key={card.name}>
              <strong>{card.qty}× {card.name}</strong>
              <span className="muted">{card.price != null ? formatUsd(card.price) : 'No price'}{card.committed ? ` · ${card.committed} other decks use this name` : ''}</span>
            </li>
          ))}
          {report.missing.length === 0 && <li>You own every card in this deck.</li>}
        </ul>
      </section>
      {report.needed > 0 && (
        <section id="fill-out">
          <h3>Fill out this deck</h3>
          <p className="hint">Needs {report.needed} more cards to reach {report.target}. These are owned cards, grouped by role.</p>
          {report.fill.map((group) => (
            <div key={group.role}>
              <h4>{group.role}</h4>
              <ul className="suggest-list">
                {group.cards.map((card) => (
                  <li key={card.name}>
                    <strong>{card.name}</strong>
                    <span className="muted">{card.reason}</span>
                    {onAdd && <button type="button" className="btn" aria-label={`Add ${card.name}`} onClick={() => onAdd(card.name)}>Add</button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SuggestionList({ items, empty, onAdd }: { items: DeckReport['adds']; empty: string; onAdd?: (name: string) => void }) {
  if (items.length === 0) return <p>{empty}</p>;
  return (
    <ul className="suggest-list" data-suggestion-count={items.length}>
      {items.map((item) => (
        <li key={item.name}>
          {item.image && <img src={item.image} alt="" />}
          <span>
            <strong>{item.name}</strong>
            {item.owned && <em className="owned-tag">Owned</em>}
            {item.price != null && <em>{formatUsd(item.price)}</em>}
            <span className="muted">{item.reason}{item.decks.length ? ` Also in ${item.decks.join(', ')}.` : ''}</span>
          </span>
          {onAdd && item.owned && <button type="button" className="btn" aria-label={`Add ${item.name}`} onClick={() => onAdd(item.name)}>Add</button>}
        </li>
      ))}
    </ul>
  );
}

function quickHealth(count: number, target: number): number {
  return Math.max(0, 100 - Math.min(40, Math.abs(count - target)));
}

function healthTone(count: number, target: number): string {
  return Math.abs(count - target) <= 2 ? 'ok' : 'low';
}
