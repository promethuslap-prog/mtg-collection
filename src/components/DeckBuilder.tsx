import { useEffect, useState } from 'react';
import {
  buildDeck,
  rankOwnedCommanders,
  rolesForCard,
  suggestColors,
  swapBuiltCard,
  type BuildFormat,
  type BuildRequest,
  type BuiltDeck,
  type PoolCard,
  type RankedCommander,
} from '../deckBuild';
import {
  enrichCollection,
  findCommanders,
  hydratePrintingCache,
  printingById,
  rememberPrinting,
  tagOracleIds,
  tagsFor,
  type CachedPrinting,
} from '../deckData';
import { searchOrdered } from '../scryfall';
import { formatSpec, playingLines, type DeckRecord } from '../deckModel';
import { downloadText } from '../io';
import { normalizeName } from '../text';
import { createUserDeck, toMoxfieldText } from '../userDecks';
import type { CollectionEntry } from '../types';
import { BRACKETS, bracketLabel, loadGameChangers, type BracketId } from '../brackets';
import { Pips } from './bits';

const FORMATS: Array<{ id: BuildFormat; label: string }> = [
  { id: 'commander', label: 'Commander' },
  { id: 'standard', label: 'Standard' },
  { id: 'pioneer', label: 'Pioneer' },
  { id: 'modern', label: 'Modern' },
  { id: 'casual', label: 'Casual 60-card' },
];
const COLORS = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' },
];
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Battle'];

interface DeckBuilderProps {
  entries: CollectionEntry[];
  decks: DeckRecord[];
  onClose: () => void;
  onSave: (deck: DeckRecord) => void;
}

export function DeckBuilder({ entries, decks, onClose, onSave }: DeckBuilderProps) {
  const [format, setFormat] = useState<BuildFormat>('commander');
  const [colors, setColors] = useState<string[]>([]);
  const [suggest, setSuggest] = useState(true);
  const [theme, setTheme] = useState('');
  const [onlyOwned, setOnlyOwned] = useState(true);
  const [buyLimit, setBuyLimit] = useState(5);
  const [allowInOtherDecks, setAllowInOtherDecks] = useState(true);
  const [bracket, setBracket] = useState<BracketId>(2);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [ranked, setRanked] = useState<RankedCommander[]>([]);
  const [commander, setCommander] = useState<PoolCard | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CachedPrinting[]>([]);
  const [status, setStatus] = useState('Reading your collection…');
  const [result, setResult] = useState<BuiltDeck | null>(null);
  const [request, setRequest] = useState<BuildRequest | null>(null);
  const [source, setSource] = useState<PoolCard[]>([]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      if (entries.length === 0) {
        setStatus('Waiting for the collection to finish syncing…');
        return;
      }
      setStatus('Reading your collection…');
      await hydratePrintingCache();
      await enrichCollection(entries.map((entry) => entry.scryfallId), (done, total) => {
        if (!cancel) setStatus(`Reading ${done} / ${total} cards…`);
      });
      if (cancel) return;
      const next = collectPool(entries, decks);
      setPool(next);
      setRanked(rankOwnedCommanders(next, 'commander'));
      setStatus('');
      void tagOracleIds(next.map((card) => card.oracleId)).then(() => {
        if (cancel) return;
        const tagged = collectPool(entries, decks);
        setPool(tagged);
        setRanked(rankOwnedCommanders(tagged, 'commander'));
      }).catch((error) => console.warn(error));
    })();
    return () => {
      cancel = true;
    };
  }, [entries, decks.map((deck) => `${deck.id}:${playingLines(deck).length}`).join('|')]);

  useEffect(() => {
    const text = query.trim();
    if (format !== 'commander' || text.length < 2) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void findCommanders(text, 'commander', 'commander', controller.signal)
        .then((cards) => { if (!controller.signal.aborted) setResults(cards); })
        .catch(() => { if (!controller.signal.aborted) setResults([]); });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, format]);

  async function build(seed = 1, selected = commander) {
    const colorsForBuild = format === 'commander'
      ? selected?.colorIdentity ?? []
      : suggest || colors.length === 0
        ? suggestColors(pool, format, theme, seed).colors
        : colors;
    if (format === 'commander' && !selected) {
      setStatus('Choose a commander you own, or search for one.');
      return;
    }
    setStatus('Building from your collection…');
    const gameChangers = format === 'commander' && bracket !== 'any' ? await loadGameChangers() : new Set<string>();
    if (format === 'commander' && bracket !== 'any' && gameChangers.size === 0) {
      setStatus('Could not load the Game Changers list from Scryfall. Try again in a moment.');
      return;
    }
    let extras: PoolCard[] = [];
    if (!onlyOwned && buyLimit > 0) {
      try {
        const found = await searchOrdered(extraQuery(format, colorsForBuild, theme), 'edhrec');
        const owned = new Set(pool.map((card) => normalizeName(card.name)));
        extras = found
          .map((card) => rememberPrinting(card))
          .filter((card) => !owned.has(normalizeName(card.name)))
          .slice(0, 40)
          .map((card) => printingToPool(card, 1, [], false));
      } catch (error) {
        console.warn(error);
      }
    }
    const nextRequest: BuildRequest = {
      format,
      commander: selected,
      colors: colorsForBuild,
      theme,
      onlyOwned,
      buyLimit: onlyOwned ? 0 : buyLimit,
      allowInOtherDecks,
      seed,
      extras,
      bracket: format === 'commander' ? bracket : 'any',
      gameChangers,
    };
    const built = buildDeck(pool, nextRequest);
    setRequest(nextRequest);
    setSource([...pool, ...extras]);
    setResult(built);
    setStatus('');
  }

  return (
    <section className="deck-builder" data-deck-builder={result ? 'result' : 'setup'}>
      <div className="row-actions">
        <button type="button" className="btn" onClick={onClose}>All decks</button>
      </div>
      <h2>Build a deck for me</h2>
      <p className="hint">Uses cards in this collection. Basics can be added past the copies you own. Nothing here is priced or saved to the repo.</p>
      {status && <p role="status">{status}</p>}
      {!result && (
        <div className="stack">
          <label className="field">Format
            <select aria-label="Build format" value={format} onChange={(event) => { setFormat(event.target.value as BuildFormat); setCommander(null); }}>
              {FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          {format === 'commander' ? (
            <>
              <h3>Commanders you can build</h3>
              <ol className="commander-rank">
                {ranked.slice(0, 12).map((item) => (
                  <li key={item.card.name}>
                    <button type="button" className="commander-pick" aria-pressed={commander?.name === item.card.name} onClick={() => setCommander(item.card)}>
                      {item.card.image && <img src={item.card.image} alt="" />}
                      <span>
                        <strong>{item.card.name}</strong>
                        <Pips colors={item.card.colorIdentity} />
                        <span className="muted">{item.playable} playable cards you own</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {ranked.length === 0 && !status && <p>No legal commanders in the collection yet.</p>}
              <div className="search-wrap">
                <label className="field">Or search any commander
                  <input aria-label="Search commander" value={query} placeholder="Sheoldred, the Apocalypse" onChange={(event) => setQuery(event.target.value)} />
                </label>
                {results.length > 0 && (
                  <ul className="suggest">
                    {results.map((card) => (
                      <li key={card.id}>
                        <button type="button" onClick={() => {
                          const owned = pool.find((item) => normalizeName(item.name) === normalizeName(card.name));
                          setCommander(owned ?? printingToPool(card, 0, [], false));
                          setResults([]);
                          setQuery(card.name);
                        }}>{card.name}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {commander && <p className="hint">Commander: {commander.name}{commander.owned ? '' : ' · not in your collection'}</p>}
              <fieldset className="bracket-picker">
                <legend>Commander bracket</legend>
                {BRACKETS.map((item) => (
                  <label key={String(item.id)} className="check">
                    <input type="radio" name="bracket" value={String(item.id)} checked={bracket === item.id} onChange={() => setBracket(item.id)} />
                    <span><strong>{item.label}</strong> — {item.blurb}</span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : (
            <>
              <div className="row-actions" role="group" aria-label="Colors">
                {COLORS.map((color) => (
                  <button key={color.id} type="button" className={`btn pip-btn pip-${color.id}`} aria-pressed={colors.includes(color.id)} onClick={() => {
                    setSuggest(false);
                    setColors((current) => current.includes(color.id) ? current.filter((item) => item !== color.id) : [...current, color.id].slice(0, 3));
                  }}>{color.label}</button>
                ))}
                <button type="button" className="btn" aria-pressed={suggest} onClick={() => { setSuggest(true); setColors([]); }}>Suggest for me</button>
              </div>
              <label className="field">Theme
                <input aria-label="Theme" value={theme} placeholder="goblins, artifacts, tokens, sacrifice" onChange={(event) => setTheme(event.target.value)} />
              </label>
            </>
          )}
          <label className="check"><input type="checkbox" checked={onlyOwned} onChange={(event) => setOnlyOwned(event.target.checked)} /> Only cards I own</label>
          {!onlyOwned && (
            <label className="field budget">Cards to buy
              <input aria-label="Cards to buy" type="number" min={0} max={20} value={buyLimit} onChange={(event) => setBuyLimit(Math.max(0, Math.min(20, Number(event.target.value) || 0)))} />
            </label>
          )}
          <label className="check"><input type="checkbox" checked={allowInOtherDecks} onChange={(event) => setAllowInOtherDecks(event.target.checked)} /> Allow cards already in other decks</label>
          <button type="button" className="btn primary" onClick={() => void build(1)} disabled={status.startsWith('Reading') || status.startsWith('Building') || status.startsWith('Waiting')}>Build</button>
        </div>
      )}
      {result && request && (
        <BuilderResult
          result={result}
          onSave={() => onSave(recordFromBuilt(result))}
          onRegenerate={() => void build(request.seed + 1, request.commander)}
          onSwap={(name) => setResult(swapBuiltCard(result, name, source, request))}
          onBack={() => setResult(null)}
        />
      )}
    </section>
  );
}

function BuilderResult({
  result,
  onSave,
  onRegenerate,
  onSwap,
  onBack,
}: {
  result: BuiltDeck;
  onSave: () => void;
  onRegenerate: () => void;
  onSwap: (name: string) => void;
  onBack: () => void;
}) {
  const record = recordFromBuilt(result);
  const text = toMoxfieldText(record);
  const maxCurve = Math.max(1, ...result.curve);
  const groups = groupCards(result.cards);
  return (
    <div className="build-result" data-build-result={result.name}>
      <p className="summary-line" data-build-summary={result.summary}>{result.summary}</p>
      {result.bracket && result.bracket !== 'any' && (
        <p className="hint" data-bracket={result.bracket}>Building at {bracketLabel(result.bracket)}</p>
      )}
      {result.commander && (
        <p className="hint">Commander: {result.commander.name}{result.commanderOwned ? ' · owned' : ' · to buy'}</p>
      )}
      {result.check && (
        <section className="bracket-check" aria-label="Bracket check">
          <h3>Bracket check · estimated {result.check.label}</h3>
          <p data-game-changers={result.check.gameChangers.join('|')}>
            Game Changers ({result.check.gameChangers.length}){result.check.gameChangers.length ? `: ${result.check.gameChangers.join(', ')}` : ''}
          </p>
          <p>{result.check.massLandDenial.length ? `Mass land denial: ${result.check.massLandDenial.join(', ')}` : 'No mass land denial'}</p>
          <p>{result.check.extraTurns.length ? `Extra turns: ${result.check.extraTurns.join(', ')}` : 'No extra turns'}</p>
          <p>{result.check.tutors.length ? `Tutors: ${result.check.tutors.join(', ')}` : 'No tutors'}</p>
          <p>{result.check.combos.length ? `Two-card combos: ${result.check.combos.map((combo) => `${combo.a} + ${combo.b}`).join('; ')}` : 'No two-card combos'}</p>
          {result.check.notes.map((note) => <p key={note}>{note}</p>)}
        </section>
      )}
      {result.skipped && result.skipped.length > 0 && (
        <ul className="issue-list">
          {result.skipped.slice(0, 8).map((skip) => <li key={skip.name}>Skipped {skip.name}: {skip.reason}</li>)}
        </ul>
      )}
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={onSave}>Save as new deck</button>
        <button type="button" className="btn" onClick={onRegenerate}>Regenerate</button>
        <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(text).catch(() => undefined)}>Copy for Moxfield</button>
        <button type="button" className="btn" onClick={() => downloadText(`${result.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'deck'}.txt`, text, 'text/plain')}>Download .txt</button>
        <button type="button" className="btn" onClick={onBack}>Change settings</button>
      </div>
      <div className="role-list">
        {result.roles.map((role) => (
          <div key={role.id} className="role-row" data-role={role.id} data-count={role.count}>
            <span>{role.label}</span>
            <span className={`level level-${role.level}`}>{role.level}</span>
            <strong>{role.count}</strong>
            <small>aim {role.aim}</small>
          </div>
        ))}
      </div>
      <div className="curve" aria-label="Mana curve">
        {result.curve.map((count, cost) => (
          <div key={cost} className="curve-col">
            <span style={{ height: `${Math.max(8, (count / maxCurve) * 88)}px` }} />
            <em>{cost === 6 ? '6+' : cost}</em>
            <small>{count}</small>
          </div>
        ))}
      </div>
      <Pips colors={Object.entries(result.colors).filter(([, count]) => count > 0).map(([color]) => color)} />
      {groups.map((group) => (
        <section key={group.type}>
          <h3>{group.type}</h3>
          <ul className="editor-list">
            {group.cards.map((card) => (
              <li key={card.card.name} className="editor-line">
                <div>
                  <strong>{card.qty}× {card.card.name}</strong>
                  <em className="origin-tag">{card.role}</em>
                  {card.toBuy && <em className="missing-tag">To buy</em>}
                  {card.card.inDecks.length > 0 && <span className="muted">Also in {card.card.inDecks.join(', ')}</span>}
                  <span className="muted">{card.reason}</span>
                </div>
                {!card.card.typeLine.toLowerCase().includes('basic') && (
                  <button type="button" className="btn" onClick={() => onSwap(card.card.name)}>Swap</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {result.toBuy.length > 0 && (
        <section>
          <h3>To buy</h3>
          <ul className="suggest-list">
            {result.toBuy.map((card) => (
              <li key={card.card.name}>
                <strong>{card.card.name}</strong>
                <a href={card.card.scryfallUri || scryfallLink(card.card.name)} target="_blank" rel="noreferrer">Scryfall</a>
                <a href={tcgLink(card.card.name)} target="_blank" rel="noreferrer">TCGplayer</a>
              </li>
            ))}
            {result.commander && !result.commanderOwned && (
              <li>
                <strong>{result.commander.name}</strong>
                <a href={result.commander.scryfallUri || scryfallLink(result.commander.name)} target="_blank" rel="noreferrer">Scryfall</a>
                <a href={tcgLink(result.commander.name)} target="_blank" rel="noreferrer">TCGplayer</a>
              </li>
            )}
          </ul>
        </section>
      )}
      <label className="field">Moxfield list
        <textarea readOnly rows={6} aria-label="Moxfield list" value={text} />
      </label>
    </div>
  );
}

function recordFromBuilt(result: BuiltDeck): DeckRecord {
  const board = result.commander
    ? [{ qty: 1, name: result.commander.name, set: result.commander.set, collectorNumber: result.commander.collectorNumber, foil: '' as const }]
    : [];
  const deck = createUserDeck(result.name, result.format, board);
  deck.mainboard = result.cards.map((card) => ({
    qty: card.qty,
    name: card.card.name,
    set: card.card.set,
    collectorNumber: card.card.collectorNumber,
    foil: '' as const,
  }));
  return deck;
}

function collectPool(entries: CollectionEntry[], decks: DeckRecord[]): PoolCard[] {
  const byName = new Map<string, PoolCard>();
  for (const entry of entries) {
    const printing = printingById(entry.scryfallId);
    if (!printing) continue;
    const key = normalizeName(printing.name);
    const inDecks = decks
      .filter((deck) => [...playingLines(deck), ...deck.sideboard, ...(deck.maybeboard ?? [])].some((line) => normalizeName(line.name) === key))
      .map((deck) => deck.name);
    const existing = byName.get(key);
    if (existing) {
      existing.qty += entry.quantity;
      continue;
    }
    byName.set(key, printingToPool(printing, entry.quantity, inDecks, true, entry.scryfallUri || entry.image));
  }
  return [...byName.values()];
}

function printingToPool(card: CachedPrinting, qty: number, inDecks: string[], owned: boolean, uri = ''): PoolCard {
  return {
    name: card.name,
    set: card.set,
    collectorNumber: card.collectorNumber,
    qty: Math.max(owned ? qty : 1, 1),
    cmc: card.cmc,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    colorIdentity: card.colorIdentity,
    oracleText: card.oracleText,
    keywords: card.keywords,
    legalities: card.legalities ?? {},
    edhrecRank: card.edhrecRank,
    image: card.image,
    producedMana: card.producedMana,
    roles: rolesForCard(card.typeLine, card.oracleText, tagsFor(card.oracleId)),
    oracleId: card.oracleId,
    scryfallUri: uri || `https://scryfall.com/card/${card.set}/${card.collectorNumber}`,
    owned,
    inDecks,
  };
}

function extraQuery(format: BuildFormat, colors: string[], theme: string): string {
  const spec = formatSpec(format);
  const parts = [theme.trim(), spec.legality ? `legal:${spec.legality}` : '', colors.length ? `id<=${colors.join('').toLowerCase()}` : '', 'game:paper'];
  return parts.filter(Boolean).join(' ');
}

function groupCards(cards: BuiltDeck['cards']): Array<{ type: string; cards: BuiltDeck['cards'] }> {
  const groups = new Map<string, BuiltDeck['cards']>();
  for (const card of cards) {
    const type = TYPE_ORDER.find((item) => card.card.typeLine.includes(item)) ?? 'Other';
    groups.set(type, [...(groups.get(type) ?? []), card]);
  }
  return TYPE_ORDER.filter((type) => groups.has(type)).map((type) => ({ type, cards: groups.get(type) ?? [] }));
}

function scryfallLink(name: string): string {
  return `https://scryfall.com/search?q=${encodeURIComponent(`!"${name}"`)}`;
}

function tcgLink(name: string): string {
  return `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(name)}`;
}
