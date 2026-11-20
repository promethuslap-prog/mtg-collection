import { useEffect, useState } from 'react';
import { analyzeDeck, combinedIdentity, type DeckReport, type KnownCard } from '../deckAnalyze';
import {
  enrichCollection,
  knownFromCollection,
  knownFromPrinting,
  loadDeckFile,
  loadPastedDecks,
  pastedDeckFromText,
  printingById,
  resolveCommanders,
  resolveLines,
  savePastedDecks,
  tagOracleIds,
  tagsFor,
  toKnown,
  upgradeSearch,
  type CachedPrinting,
} from '../deckData';
import { deckSize, formatTarget, type DeckRecord } from '../deckModel';
import { formatSyncDate, formatUsd } from '../format';
import { Pips } from './bits';
import type { CollectionEntry } from '../types';

interface DecksProps {
  entries: CollectionEntry[];
}

export function DecksSection({ entries }: DecksProps) {
  const [decks, setDecks] = useState<DeckRecord[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [pasted, setPasted] = useState<DeckRecord[]>(() => loadPastedDecks());
  const [commanders, setCommanders] = useState<Record<string, CachedPrinting>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadDeckFile().then(async (file) => {
      if (!file) {
        setError('Could not read decks.json.');
        return;
      }
      setDecks(file.decks);
      setUpdatedAt(file.updatedAt);
      const names = [...new Set(file.decks.flatMap((deck) => deck.commanders))];
      const cards = await resolveCommanders(names);
      const next: Record<string, CachedPrinting> = {};
      for (const card of cards) next[card.name.toLowerCase()] = card;
      setCommanders(next);
    }).catch((reason) => {
      console.warn(reason);
      setError('Could not load decks.');
    });
  }, []);

  const all = [...decks, ...pasted];
  const open = all.find((deck) => deck.id === openId) ?? null;

  return (
    <div className="decks">
      {open ? (
        <DeckPage
          deck={open}
          entries={entries}
          commanders={commanders}
          decks={all}
          onBack={() => setOpenId(null)}
        />
      ) : (
        <>
          <div className="deck-intro">
            <h2>Decks</h2>
            <p className="hint">
              {updatedAt ? `Deck list from Moxfield · ${formatSyncDate(updatedAt)}` : 'Loading decks from Moxfield.'}
              {' '}Suggestions use the collection synced on this device.
            </p>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="deck-grid">
            {all.map((deck) => {
              const arts = deck.commanders.map((name) => commanders[name.toLowerCase()]).filter(Boolean);
              const identity = combinedIdentity(arts.map((card) => card.colorIdentity));
              const count = deckSize(deck);
              const target = formatTarget(deck.format);
              return (
                <button key={deck.id} type="button" className="deck-card" onClick={() => setOpenId(deck.id)}>
                  <span className="deck-art">
                    {arts[0]?.image ? <img src={arts[0].image} alt="" /> : <span className="fallback">{deck.commanders[0] ?? deck.name}</span>}
                  </span>
                  <span className="deck-copy">
                    <strong>{deck.name}</strong>
                    <span className="muted">{deck.format} · {count}/{target}{deck.pasted ? ' · pasted' : ''}</span>
                    <Pips colors={identity} />
                    <span className={`health health-${healthTone(count, target)}`}>Health {quickHealth(count, target)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <PasteDeck onSave={(deck) => {
            const next = [deck, ...pasted];
            setPasted(next);
            savePastedDecks(next);
            setOpenId(deck.id);
          }} />
        </>
      )}
    </div>
  );
}

function DeckPage({
  deck,
  entries,
  commanders,
  decks,
  onBack,
}: {
  deck: DeckRecord;
  entries: CollectionEntry[];
  commanders: Record<string, CachedPrinting>;
  decks: DeckRecord[];
  onBack: () => void;
}) {
  const [report, setReport] = useState<DeckReport | null>(null);
  const [budget, setBudget] = useState(5);
  const [status, setStatus] = useState('Reading the deck…');
  const [panel, setPanel] = useState<'add' | 'buy' | 'cut' | 'swap'>('add');

  useEffect(() => {
    let cancel = false;
    setReport(null);
    setStatus('Matching printings on Scryfall…');
    void (async () => {
      const printings = await resolveLines(deck.mainboard);
      const byKey = new Map(printings.map((card) => [`${card.set}|${card.collectorNumber.toLowerCase()}`, card]));
      const byName = new Map(printings.map((card) => [card.name.toLowerCase(), card]));
      const paired = deck.mainboard.map((line) => {
        const printing = (line.set && line.collectorNumber
          ? byKey.get(`${line.set}|${line.collectorNumber.toLowerCase()}`)
          : undefined) ?? byName.get(line.name.toLowerCase());
        return { line, printing };
      });
      const identityCards = deck.commanders.map((name) => commanders[name.toLowerCase()]).filter(Boolean);
      const identity = combinedIdentity(identityCards.map((card) => card.colorIdentity));
      const otherDecks = decks.map((item) => ({ id: item.id, name: item.name, names: item.mainboard.map((line) => line.name) }));
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
        card.legality = deck.format === 'standard' ? printing.legalityStandard : printing.legalityCommander;
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

  return (
    <article className="deck-page" data-deck-page={deck.name}>
      <button type="button" className="btn" onClick={onBack}>All decks</button>
      <header className="deck-hero">
        <div className="deck-hero-art">
          {arts.map((card) => <img key={card.id} src={card.image} alt={card.name} />)}
        </div>
        <div>
          <p className="eyebrow">{deck.format}</p>
          <h2>{deck.name}</h2>
          <Pips colors={combinedIdentity(arts.map((card) => card.colorIdentity))} />
          {deck.url && <p><a href={deck.url} target="_blank" rel="noreferrer">View on Moxfield</a></p>}
          {report && <p className={`health health-${report.health >= 75 ? 'ok' : 'low'}`}>Health {report.health} · {report.cardCount}/{report.target} cards · avg MV {report.averageMv.toFixed(2)}</p>}
        </div>
      </header>
      {status && <p role="status">{status}</p>}
      {report && <DeckBody report={report} budget={budget} onBudget={setBudget} panel={panel} onPanel={setPanel} />}
    </article>
  );
}

function DeckBody({
  report,
  budget,
  onBudget,
  panel,
  onPanel,
}: {
  report: DeckReport;
  budget: number;
  onBudget: (value: number) => void;
  panel: 'add' | 'buy' | 'cut' | 'swap';
  onPanel: (panel: 'add' | 'buy' | 'cut' | 'swap') => void;
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
        {panel === 'add' && <SuggestionList items={report.adds} empty="No owned cards fit this deck." />}
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
                {group.cards.map((card) => <li key={card.name}><strong>{card.name}</strong> <span className="muted">{card.reason}</span></li>)}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SuggestionList({ items, empty }: { items: DeckReport['adds']; empty: string }) {
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
        </li>
      ))}
    </ul>
  );
}

function PasteDeck({ onSave }: { onSave: (deck: DeckRecord) => void }) {
  const [name, setName] = useState('Pasted deck');
  const [format, setFormat] = useState<DeckRecord['format']>('commander');
  const [commanders, setCommanders] = useState('');
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  return (
    <section className="paste-deck">
      <h3>Analyze a pasted deck</h3>
      <p className="hint">Paste plain text or a Moxfield list, like <code>1 Sol Ring (C21) 263</code>. It stays in this browser.</p>
      <div className="paste-grid">
        <label className="field">Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field">Format
          <select value={format} onChange={(event) => setFormat(event.target.value as DeckRecord['format'])}>
            <option value="commander">Commander</option>
            <option value="standard">Standard</option>
          </select>
        </label>
        <label className="field">Commanders<input value={commanders} placeholder="Jadar, Ghoulcaller of Nephalia" onChange={(event) => setCommanders(event.target.value)} /></label>
      </div>
      <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} placeholder={'1 Sol Ring (C21) 263\n1 Jadar, Ghoulcaller of Nephalia'} />
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          const deck = pastedDeckFromText(name, format, commanders.split(',').map((item) => item.trim()).filter(Boolean), text);
          if (!deck) {
            setMessage('No cards found. Use lines like 1 Sol Ring (C21) 263.');
            return;
          }
          setMessage('');
          onSave(deck);
        }}
      >
        Analyze this deck
      </button>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}

function quickHealth(count: number, target: number): number {
  return Math.max(0, 100 - Math.min(40, Math.abs(count - target)));
}

function healthTone(count: number, target: number): string {
  return Math.abs(count - target) <= 2 ? 'ok' : 'low';
}
