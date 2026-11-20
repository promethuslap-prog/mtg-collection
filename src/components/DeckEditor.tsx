import { useEffect, useId, useState } from 'react';
import { isOutsidePaper, type ScryfallCard } from '../cards';
import { combinedIdentity, legalityNotes, listDeckIssues, type KnownCard } from '../deckAnalyze';
import {
  deckCardQuery,
  findCommanders,
  findLegalNames,
  rememberPrinting,
  resolveCommanders,
  resolveLines,
  toKnown,
  type CachedPrinting,
} from '../deckData';
import { DECK_FORMATS, deckSize, formatSpec, formatTarget, linesOf, playingLines, type DeckCardLine, type DeckFormat, type DeckRecord, type DeckSectionName } from '../deckModel';
import { downloadText } from '../io';
import { autocomplete, searchOrdered, searchPrintings } from '../scryfall';
import { normalizeName } from '../text';
import { commanderCompanion, createUserDeck, foilMark, sectionLabel, toMoxfieldText, upsertLine, userDeckFromText, withSection } from '../userDecks';
import type { CollectionEntry } from '../types';
import { Modal } from './Modal';
import { Quantity } from './Quantity';

interface DeckEditorProps {
  deck: DeckRecord;
  entries: CollectionEntry[];
  decks: DeckRecord[];
  onChange: (deck: DeckRecord) => void;
  onDone: () => void;
}

interface PrintingChoice {
  id: string;
  label: string;
  name: string;
  set: string;
  collectorNumber: string;
  foil: boolean;
}

const SECTIONS: DeckSectionName[] = ['commander', 'mainboard', 'sideboard', 'maybeboard'];

export function DeckEditor({ deck, entries, decks, onChange, onDone }: DeckEditorProps) {
  const spec = formatSpec(deck.format);
  const sections = SECTIONS.filter((section) => section !== 'commander' || spec.commander);
  const [section, setSection] = useState<DeckSectionName>('mainboard');
  const [identity, setIdentity] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [restrict, setRestrict] = useState(true);
  const [hits, setHits] = useState<CachedPrinting[]>([]);
  const [active, setActive] = useState<CachedPrinting | null>(null);
  const [choices, setChoices] = useState<PrintingChoice[]>([]);
  const [choiceId, setChoiceId] = useState('');
  const [qty, setQty] = useState(1);
  const [foil, setFoil] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const [searching, setSearching] = useState(false);
  const listId = useId();
  const lines = linesOf(deck, section);
  const activeSection = sections.includes(section) ? section : sections[0];

  useEffect(() => {
    let cancel = false;
    void resolveCommanders(deck.commanders).then((cards) => {
      if (!cancel) setIdentity(combinedIdentity(cards.map((card) => card.colorIdentity)));
    });
    return () => {
      cancel = true;
    };
  }, [deck.commanders]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const playing = playingLines(deck);
      const printings = await resolveLines(playing);
      if (cancel) return;
      const known = aggregate(playing.map((line) => {
        const printing = matchPrinting(line, printings);
        return toKnown(line, printing, [], deck.format) ?? placeholder(line);
      }));
      const next = listDeckIssues(deck, known, identity);
      const casual = legalityNotes(deck, known);
      for (const line of deck.mainboard) {
        if (deck.commanders.some((name) => normalizeName(name) === normalizeName(line.name))) {
          next.push(`${line.name} is already in the command zone.`);
        }
      }
      if (!cancel) {
        setIssues([...new Set(next)]);
        setNotes([...new Set(casual)]);
      }
    })().catch((error) => console.warn(error));
    return () => {
      cancel = true;
    };
  }, [deck, identity]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2 || /[:"]/.test(text)) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const names = ownedOnly
            ? ownedSuggestions(entries, text, deck.format, identity, restrict)
            : restrict
              ? await findLegalNames(text, deck.format, identity, controller.signal, Boolean(deck.ignoreLegality))
              : await autocomplete(text, controller.signal);
          if (!controller.signal.aborted) setSuggestions(names);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return;
          if (!controller.signal.aborted) setSuggestions([]);
        }
      })();
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, ownedOnly, restrict, entries, deck.format, deck.ignoreLegality, identity]);

  function chooseName(name: string) {
    setQuery(name);
    setSuggestions([]);
    void pickCard(name);
  }

  async function pickCard(name: string) {
    setSearching(true);
    setSearchNote('');
    try {
      const owned = entries.find((entry) => normalizeName(entry.name) === normalizeName(name));
      const line: DeckCardLine = {
        qty: 1,
        name: owned?.name ?? name,
        set: owned?.set ?? '',
        collectorNumber: owned?.collectorNumber ?? '',
        foil: '',
      };
      const printings = await resolveLines([line]);
      const card = printings.find((item) => normalizeName(item.name) === normalizeName(name)) ?? printings[0];
      if (!card) {
        setSearchNote('Scryfall did not return that card. Try Search.');
        return;
      }
      prepare(card);
    } catch (error) {
      setSearchNote(error instanceof Error ? error.message : 'Could not look up that card.');
    } finally {
      setSearching(false);
    }
  }

  async function runSearch(text = query) {
    const raw = text.trim();
    if (!raw && restrict) {
      setSearchNote('Type a card or a Scryfall query.');
      return;
    }
    setSearching(true);
    setSearchNote('');
    try {
      const cards = await searchOrdered(deckCardQuery(raw, deck.format, identity, restrict, Boolean(deck.ignoreLegality)), 'name');
      let next = cards.map((card) => rememberPrinting(card));
      if (!deck.includeUncards) next = next.filter((card) => !isOutsidePaper(card));
      if (ownedOnly) {
        const owned = new Set(entries.map((entry) => normalizeName(entry.name)));
        next = next.filter((card) => owned.has(normalizeName(card.name)));
      }
      setHits(next.slice(0, 20));
      setSearchNote(next.length === 0 ? 'No cards matched.' : '');
      if (next[0] && normalizeName(next[0].name) === normalizeName(raw)) prepare(next[0]);
    } catch (error) {
      setSearchNote(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  function prepare(card: CachedPrinting) {
    const options = printingOptions(card, entries);
    const preferred = options.find((option) => option.label.includes('owned')) ?? options[0];
    setActive(card);
    setChoices(options);
    setChoiceId(preferred?.id ?? '');
    setFoil(preferred?.foil ?? false);
    setQty(1);
  }

  async function morePrintings() {
    if (!active) return;
    setSearching(true);
    try {
      const result = await searchPrintings(active.name, false, undefined, 1);
      const extras = result.cards.map((card) => choiceFromCard(card));
      const merged = [...choices];
      for (const extra of extras) {
        if (!merged.some((item) => item.id === extra.id)) merged.push(extra);
      }
      setChoices(merged);
    } catch (error) {
      setSearchNote(error instanceof Error ? error.message : 'Could not load printings.');
    } finally {
      setSearching(false);
    }
  }

  function addActive() {
    if (!active) return;
    const choice = choices.find((item) => item.id === choiceId) ?? choices[0];
    const line: DeckCardLine = {
      qty,
      name: choice?.name ?? active.name,
      set: choice?.set ?? active.set,
      collectorNumber: choice?.collectorNumber ?? active.collectorNumber,
      foil: foil ? 'foil' : '',
    };
    onChange(withSection(deck, activeSection, upsertLine(linesOf(deck, activeSection), line)));
    setActive(null);
    setQuery('');
    setHits([]);
  }

  function patchLine(index: number, line: DeckCardLine) {
    const next = linesOf(deck, activeSection).slice();
    next[index] = line;
    onChange(withSection(deck, activeSection, next));
  }

  function removeLine(index: number) {
    onChange(withSection(deck, activeSection, linesOf(deck, activeSection).filter((_, item) => item !== index)));
  }

  function toggleFoil(index: number) {
    const current = linesOf(deck, activeSection);
    const line = current[index];
    const nextFoil = foilMark(line.foil) === 'foil' ? '' : 'foil';
    const rest = current.filter((_, item) => item !== index);
    onChange(withSection(deck, activeSection, upsertLine(rest, { ...line, foil: nextFoil })));
  }

  return (
    <section className="deck-editor" data-deck-editor={deck.name}>
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={onDone}>Deck check</button>
      </div>
      <DeckExport deck={deck} />
      <label className="field">
        Name
        <input value={deck.name} onChange={(event) => onChange({ ...deck, name: event.target.value })} />
      </label>
      <p className={`count-pill ${deckSize(deck) === formatTarget(deck.format) || (!spec.exact && deckSize(deck) >= spec.size) ? 'health-ok' : 'health-low'}`}>
        {deckSize(deck)} / {formatTarget(deck.format)} {spec.label}
        {spec.exact ? '' : '+'}
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={deck.ignoreLegality === true}
          onChange={(event) => onChange({ ...deck, ignoreLegality: event.target.checked, includeUncards: event.target.checked ? deck.includeUncards : false })}
        />
        Ignore banned & illegal cards (casual)
      </label>
      {deck.ignoreLegality && (
        <>
          <p className="origin-tag">Casual: legality ignored</p>
          <label className="check">
            <input type="checkbox" checked={deck.includeUncards === true} onChange={(event) => onChange({ ...deck, includeUncards: event.target.checked })} />
            Include Un-/acorn/digital cards
          </label>
        </>
      )}
      {issues.length > 0 && (
        <ul className="issue-list">
          {issues.slice(0, 8).map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="suggest-list">
          {notes.slice(0, 8).map((note) => <li key={note} className="muted">{note}</li>)}
        </ul>
      )}
      <div className="row-actions" role="tablist" aria-label="Deck sections">
        {sections.map((item) => (
          <button key={item} type="button" className="btn" role="tab" aria-selected={activeSection === item} onClick={() => setSection(item)}>
            {sectionLabel(item)} ({linesOf(deck, item).reduce((sum, line) => sum + line.qty, 0)})
          </button>
        ))}
      </div>
      <div className="search-wrap">
        <label className="field">
          Card search
          <input
            aria-label="Card search"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            value={query}
            placeholder="Sol Ring or t:goblin"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (suggestions[0]) chooseName(suggestions[0]);
                else void runSearch();
              }
            }}
          />
        </label>
        {suggestions.length > 0 && (
          <ul className="suggest" id={listId} role="listbox">
            {suggestions.map((name) => (
              <li key={name}><button type="button" role="option" onClick={() => chooseName(name)}>{name}</button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="row-actions">
        <label className="check"><input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} /> Only cards I own</label>
        <label className="check"><input type="checkbox" checked={restrict} onChange={(event) => setRestrict(event.target.checked)} /> Match format and colors</label>
        <button type="button" className="btn" onClick={() => void runSearch()} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
      </div>
      {searchNote && <p role="status">{searchNote}</p>}
      {hits.length > 0 && (
        <ul className="suggest-list">
          {hits.map((card) => (
            <li key={card.id}>
              {card.image && <img src={card.image} alt="" />}
              <button type="button" className="btn" onClick={() => prepare(card)}>{card.name}</button>
              <OwnedMarks name={card.name} entries={entries} decks={decks} deckId={deck.id} />
            </li>
          ))}
        </ul>
      )}
      {active && (
        <div className="add-panel">
          <h3>Add {active.name}</h3>
          <label className="field">
            Printing
            <select aria-label="Printing" value={choiceId} onChange={(event) => {
              const next = event.target.value;
              setChoiceId(next);
              const choice = choices.find((item) => item.id === next);
              if (choice) setFoil(choice.foil);
            }}>
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => void morePrintings()}>More printings</button>
          <Quantity value={qty} onChange={setQty} label={`copies of ${active.name}`} />
          <label className="check"><input type="checkbox" checked={foil} onChange={(event) => setFoil(event.target.checked)} /> Foil</label>
          <button type="button" className="btn primary" onClick={addActive}>Add to {sectionLabel(activeSection)}</button>
        </div>
      )}
      <ul className="editor-list">
        {lines.map((line, index) => (
          <li key={`${line.name}-${line.set}-${line.collectorNumber}-${index}`} className="editor-line">
            <div>
              <strong>{line.name}</strong>
              <span className="muted">{printingCaption(line)}</span>
              <OwnedMarks name={line.name} entries={entries} decks={decks} deckId={deck.id} />
            </div>
            <div className="editor-actions">
              <Quantity value={line.qty} onChange={(value) => patchLine(index, { ...line, qty: value })} label={line.name} />
              <button type="button" className="btn" aria-label={`Foil ${line.name}`} aria-pressed={foilMark(line.foil) === 'foil'} onClick={() => toggleFoil(index)}>Foil</button>
              <button type="button" className="btn" aria-label={`Remove ${line.name}`} onClick={() => removeLine(index)}>Remove</button>
            </div>
          </li>
        ))}
        {lines.length === 0 && <li className="muted">No cards in {sectionLabel(activeSection).toLowerCase()} yet.</li>}
      </ul>
    </section>
  );
}

export function DeckExport({ deck }: { deck: DeckRecord }) {
  const [note, setNote] = useState('');
  const text = toMoxfieldText(deck);
  return (
    <div className="export-box">
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => setNote('Copied the Moxfield list.'),
              () => setNote('Select the list below and copy it.'),
            );
          }}
        >
          Copy for Moxfield
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => downloadText(`${deck.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'deck'}.txt`, text, 'text/plain')}
        >
          Download .txt
        </button>
      </div>
      <label className="field">
        Moxfield list
        <textarea readOnly rows={4} value={text} aria-label="Moxfield list" />
      </label>
      {note && <p role="status">{note}</p>}
    </div>
  );
}

export function NewDeckDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (deck: DeckRecord) => void }) {
  const [name, setName] = useState('New deck');
  const [format, setFormat] = useState<DeckFormat>('commander');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CachedPrinting[]>([]);
  const [commander, setCommander] = useState<CachedPrinting | null>(null);
  const [partnerQuery, setPartnerQuery] = useState('');
  const [partners, setPartners] = useState<CachedPrinting[]>([]);
  const [partner, setPartner] = useState<CachedPrinting | null>(null);
  const [message, setMessage] = useState('');
  const spec = formatSpec(format);
  const companion = commander ? commanderCompanion(commander.keywords, commander.oracleText) : null;

  useEffect(() => {
    if (!spec.commander || query.trim().length < 2) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void findCommanders(query, format, 'commander', controller.signal)
        .then((cards) => { if (!controller.signal.aborted) setSuggestions(cards); })
        .catch((error) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          setSuggestions([]);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, format, spec.commander]);

  useEffect(() => {
    if (!companion || companion.kind === 'named' || partnerQuery.trim().length < 2) {
      setPartners([]);
      return undefined;
    }
    const controller = new AbortController();
    const kind = companion.kind === 'background' ? 'background' : 'partner';
    const timer = window.setTimeout(() => {
      void findCommanders(partnerQuery, format, kind, controller.signal)
        .then((cards) => { if (!controller.signal.aborted) setPartners(cards); })
        .catch(() => { if (!controller.signal.aborted) setPartners([]); });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [partnerQuery, companion, format]);

  function create() {
    if (spec.commander && !commander) {
      setMessage('Pick a legal commander.');
      return;
    }
    const board = [commander, partner].filter((card): card is CachedPrinting => card !== null).map((card) => ({
      qty: 1,
      name: card.name,
      set: card.set,
      collectorNumber: card.collectorNumber,
      foil: '' as const,
    }));
    onCreate(createUserDeck(name, format, board));
  }

  return (
    <Modal title="New deck" onClose={onClose}>
      <div className="stack">
        <label className="field">Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field">Format
          <select aria-label="Format" value={format} onChange={(event) => {
            setFormat(event.target.value as DeckFormat);
            setCommander(null);
            setPartner(null);
          }}>
            {DECK_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {spec.commander && (
          <div className="search-wrap">
            <label className="field">Commander
              <input aria-label="Commander" value={commander ? commander.name : query} onChange={(event) => { setCommander(null); setPartner(null); setQuery(event.target.value); }} placeholder="Krenko, Mob Boss" />
            </label>
            {suggestions.length > 0 && !commander && (
              <ul className="suggest" role="listbox" aria-label="Legal commanders">
                {suggestions.map((card) => (
                  <li key={card.id}><button type="button" onClick={() => { setCommander(card); setSuggestions([]); }}>{card.name}</button></li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && suggestions.length === 0 && !commander && <p className="hint">No legal commander matches that.</p>}
          </div>
        )}
        {companion?.kind === 'named' && !partner && (
          <button type="button" className="btn" onClick={() => {
            void resolveCommanders([companion.name]).then((cards) => { if (cards[0]) setPartner(cards[0]); });
          }}>Add partner {companion.name}</button>
        )}
        {companion && companion.kind !== 'named' && (
          <div className="search-wrap">
            <label className="field">{companion.kind === 'background' ? 'Background' : 'Partner'}
              <input aria-label={companion.kind === 'background' ? 'Background' : 'Partner'} value={partner ? partner.name : partnerQuery} placeholder="Optional" onChange={(event) => { setPartner(null); setPartnerQuery(event.target.value); }} />
            </label>
            {partners.length > 0 && !partner && (
              <ul className="suggest">
                {partners.map((card) => <li key={card.id}><button type="button" onClick={() => setPartner(card)}>{card.name}</button></li>)}
              </ul>
            )}
          </div>
        )}
        {partner && <p className="hint">Partner: {partner.name}</p>}
        {message && <p role="alert">{message}</p>}
        <button type="button" className="btn primary" onClick={create}>Create deck</button>
      </div>
    </Modal>
  );
}

export function ImportDeckDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (deck: DeckRecord) => void }) {
  const [name, setName] = useState('Imported deck');
  const [format, setFormat] = useState<DeckFormat>('commander');
  const [commanders, setCommanders] = useState('');
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  return (
    <Modal title="Import deck" onClose={onClose}>
      <div className="stack">
        <p className="hint">Paste plain text or a Moxfield list, like <code>1 Sol Ring (C21) 263</code>. Commander, Deck, Sideboard, and Maybeboard headers are kept.</p>
        <label className="field">Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field">Format
          <select aria-label="Import format" value={format} onChange={(event) => setFormat(event.target.value as DeckFormat)}>
            {DECK_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="field">Commanders
          <input value={commanders} placeholder="Optional if the list has a Commander section" onChange={(event) => setCommanders(event.target.value)} />
        </label>
        <textarea aria-label="Decklist" rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder={'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring (C21) 263'} />
        {message && <p role="alert">{message}</p>}
        <button type="button" className="btn primary" onClick={() => {
          const deck = userDeckFromText(name, format, commanders.split(',').map((item) => item.trim()).filter(Boolean), text);
          if (!deck) {
            setMessage('No cards found. Use lines like 1 Sol Ring (C21) 263.');
            return;
          }
          onCreate(deck);
        }}>Import deck</button>
      </div>
    </Modal>
  );
}

function OwnedMarks({ name, entries, decks, deckId }: { name: string; entries: CollectionEntry[]; decks: DeckRecord[]; deckId: string }) {
  const owned = entries.reduce((sum, entry) => sum + (normalizeName(entry.name) === normalizeName(name) ? entry.quantity : 0), 0);
  const others = decks.filter((deck) => deck.id !== deckId && [...playingLines(deck), ...deck.sideboard, ...(deck.maybeboard ?? [])].some((line) => normalizeName(line.name) === normalizeName(name))).map((deck) => deck.name);
  return (
    <span className="mark-row">
      {owned > 0 ? <em className="owned-tag">Owned</em> : <em className="missing-tag">Missing</em>}
      {others.length > 0 && <span className="muted">Used in {others.join(', ')}</span>}
    </span>
  );
}

function ownedSuggestions(entries: CollectionEntry[], query: string, format: DeckFormat, identity: string[], restrict: boolean): string[] {
  const needle = normalizeName(query);
  const names = new Map<string, CollectionEntry>();
  for (const entry of entries) {
    if (!normalizeName(entry.name).includes(needle)) continue;
    if (!names.has(normalizeName(entry.name))) names.set(normalizeName(entry.name), entry);
  }
  const spec = formatSpec(format);
  return [...names.values()].filter((entry) => {
    if (!restrict || !spec.commander || identity.length === 0) return true;
    return entry.colorIdentity.every((color) => identity.includes(color));
  }).map((entry) => entry.name).slice(0, 12);
}

function printingOptions(card: CachedPrinting, entries: CollectionEntry[]): PrintingChoice[] {
  const owned = entries.filter((entry) => normalizeName(entry.name) === normalizeName(card.name));
  const options = owned.map((entry) => ({
    id: `${entry.scryfallId}:${entry.finish}`,
    label: `${(entry.setName || entry.set).toUpperCase()} #${entry.collectorNumber} · owned`,
    name: entry.name,
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    foil: entry.finish === 'foil',
  }));
  if (!options.some((option) => option.set.toLowerCase() === card.set.toLowerCase() && option.collectorNumber === card.collectorNumber)) {
    options.unshift({
      id: card.id,
      label: `${card.set.toUpperCase()} #${card.collectorNumber}`,
      name: card.name,
      set: card.set,
      collectorNumber: card.collectorNumber,
      foil: false,
    });
  }
  return options;
}

function choiceFromCard(card: ScryfallCard): PrintingChoice {
  rememberPrinting(card);
  return {
    id: card.id,
    label: `${card.set.toUpperCase()} #${card.collector_number} · ${card.set_name}`,
    name: card.name,
    set: card.set,
    collectorNumber: card.collector_number,
    foil: false,
  };
}

function matchPrinting(line: DeckCardLine, printings: CachedPrinting[]): CachedPrinting | undefined {
  const bySet = printings.find((card) => line.set && line.collectorNumber && card.set === line.set && card.collectorNumber.toLowerCase() === line.collectorNumber.toLowerCase());
  return bySet ?? printings.find((card) => normalizeName(card.name) === normalizeName(line.name));
}

function placeholder(line: DeckCardLine): KnownCard {
  return {
    name: line.name,
    set: line.set,
    collectorNumber: line.collectorNumber,
    qty: line.qty,
    cmc: 0,
    manaCost: '',
    typeLine: '',
    colorIdentity: [],
    oracleText: '',
    keywords: [],
    legality: '',
    edhrecRank: null,
    priceUsd: null,
    image: '',
    producedMana: [],
    roles: [],
  };
}

function aggregate(cards: KnownCard[]): KnownCard[] {
  const map = new Map<string, KnownCard>();
  for (const card of cards) {
    const key = normalizeName(card.name);
    const existing = map.get(key);
    if (!existing) map.set(key, { ...card });
    else existing.qty += card.qty;
  }
  return [...map.values()];
}

function printingCaption(line: DeckCardLine): string {
  const set = line.set ? line.set.toUpperCase() : '';
  const number = line.collectorNumber ? ` #${line.collectorNumber}` : '';
  const finish = foilMark(line.foil) === 'foil' ? ' · foil' : foilMark(line.foil) === 'etched' ? ' · etched' : '';
  return `${set}${number}${finish}`.trim();
}
