import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { availableFinishes, cardImages, cardToEntry, priceForFinish, type ScryfallCard } from '../cards';
import { entryKey } from '../cards';
import { autocomplete, searchPrintings } from '../scryfall';
import { finishLabel, formatUsd, rarityLabel } from '../format';
import type { CollectionEntry, Finish } from '../types';
import { Modal } from './Modal';

interface AddCardProps {
  entries: CollectionEntry[];
  onAdd: (entry: CollectionEntry) => void;
}

interface ReadyPicker {
  status: 'ready';
  name: string;
  allLang: boolean;
  cards: ScryfallCard[];
  truncated: boolean;
  selectedId: string;
  finish: Finish;
  quantity: number;
  filter: string;
  face: 'front' | 'back';
}

type Picker =
  | { status: 'closed' }
  | { status: 'loading'; name: string; allLang: boolean }
  | ReadyPicker
  | { status: 'error'; name: string; allLang: boolean; message: string };

function chooseDefault(cards: ScryfallCard[]): ScryfallCard {
  const englishPaper = cards.filter((card) => (card.lang ?? 'en') === 'en' && card.games?.includes('paper'));
  const pool = englishPaper.length > 0 ? englishPaper : cards;
  return (
    pool.find((card) => availableFinishes(card).includes('nonfoil') && priceForFinish(card, 'nonfoil') != null) ??
    pool.find((card) => availableFinishes(card).some((finish) => priceForFinish(card, finish) != null)) ??
    pool[0]
  );
}

function defaultFinish(card: ScryfallCard): Finish {
  const finishes = availableFinishes(card);
  return finishes.includes('nonfoil') ? 'nonfoil' : finishes[0];
}

function printingLabel(card: ScryfallCard): string {
  const price = card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched;
  const parts = [
    `${card.set_name} (${card.set.toUpperCase()})`,
    `#${card.collector_number}`,
    rarityLabel(card.rarity ?? ''),
  ];
  if (card.lang && card.lang !== 'en') parts.push(card.lang.toUpperCase());
  if (card.games && !card.games.includes('paper')) parts.push('digital');
  parts.push(price ? formatUsd(Number(price)) : 'no USD price');
  return parts.join(' · ');
}

export function AddCard({ entries, onAdd }: AddCardProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>({ status: 'closed' });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      setSearchError(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setSearching(true);
        setSearchError(null);
        const names = await autocomplete(q, controller.signal);
        setSuggestions(names);
        setOpen(true);
        setActive(names.length > 0 ? 0 : -1);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setSuggestions([]);
        setSearchError(error instanceof Error ? error.message : 'Search failed.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function loadPrintings(name: string, allLang: boolean) {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPicker({ status: 'loading', name, allLang });
    setOpen(false);
    try {
      const result = await searchPrintings(name, allLang, controller.signal);
      if (requestId !== requestRef.current) return;
      if (result.cards.length === 0) {
        setPicker({ status: 'error', name, allLang, message: allLang ? 'Scryfall has no printings for that card.' : 'No English printings found. Try all languages.' });
        return;
      }
      const selected = chooseDefault(result.cards);
      setPicker({
        status: 'ready',
        name,
        allLang,
        cards: result.cards,
        truncated: result.truncated,
        selectedId: selected.id,
        finish: defaultFinish(selected),
        quantity: 1,
        filter: '',
        face: 'front',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (requestId !== requestRef.current) return;
      setPicker({
        status: 'error',
        name,
        allLang,
        message: error instanceof Error ? error.message : 'Could not load printings.',
      });
    }
  }

  function choose(name: string) {
    setQuery(name);
    setSuggestions([]);
    setOpen(false);
    void loadPrintings(name, false);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      setActive((index) => Math.min(suggestions.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Enter' && open && suggestions[active]) {
      event.preventDefault();
      choose(suggestions[active]);
    }
  }

  const ready = picker.status === 'ready' ? picker : null;
  const selected = ready?.cards.find((card) => card.id === ready.selectedId) ?? null;
  const finishes = selected ? availableFinishes(selected) : [];
  const images = selected ? cardImages(selected) : {};
  const shownImage = ready?.face === 'back' && images.back ? images.back : images.front;
  const owned = selected && ready ? entries.find((entry) => entry.id === entryKey(selected.id, ready.finish))?.quantity ?? 0 : 0;

  const filteredCards = ready
    ? ready.cards.filter((card) => {
        const needle = ready.filter.trim().toLowerCase();
        if (!needle) return true;
        return `${card.set_name} ${card.set} ${card.collector_number} ${card.rarity ?? ''} ${card.lang ?? ''}`.toLowerCase().includes(needle);
      })
    : [];
  const optionCards = ready && selected && !filteredCards.some((card) => card.id === selected.id) ? [selected, ...filteredCards] : filteredCards;

  return (
    <section className="add-card" aria-label="Add a card">
      <div className="add-label-row">
        <label htmlFor="add-card-search">Add a card</label>
        <span className="kbd-hint">
          Press <kbd>/</kbd>
        </span>
      </div>
      <div className="search-wrap">
        <input
          id="add-card-search"
          ref={inputRef}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Search Scryfall by card name"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onKeyDown={onInputKeyDown}
        />
        {open && (suggestions.length > 0 || searching || searchError) && (
          <ul id={listId} className="suggest" role="listbox">
            {searching && suggestions.length === 0 && <li className="suggest-note">Searching Scryfall…</li>}
            {searchError && <li className="suggest-note">{searchError}</li>}
            {suggestions.map((name, index) => (
              <li key={name} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(name)}
                >
                  {highlight(name, query)}
                </button>
              </li>
            ))}
            {!searching && suggestions.length === 0 && query.trim().length >= 2 && !searchError && (
              <li className="suggest-note">No cards match that name.</li>
            )}
          </ul>
        )}
      </div>
      <p className="hint">Pick a printing, then choose nonfoil or foil. Names come from Scryfall.</p>
      <span className="sr-only" aria-live="polite">
        {searching ? 'Searching Scryfall' : open ? `${suggestions.length} suggestions` : ''}
      </span>

      {picker.status === 'loading' && (
        <Modal title={picker.name} onClose={() => { abortRef.current?.abort(); setPicker({ status: 'closed' }); }}>
          <p role="status">Loading printings from Scryfall…</p>
        </Modal>
      )}

      {picker.status === 'error' && (
        <Modal title={picker.name} onClose={() => setPicker({ status: 'closed' })}>
          <p role="alert">{picker.message}</p>
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => void loadPrintings(picker.name, picker.allLang)}>
              Try again
            </button>
            {!picker.allLang && (
              <button type="button" className="btn" onClick={() => void loadPrintings(picker.name, true)}>
                Include other languages
              </button>
            )}
          </div>
        </Modal>
      )}

      {ready && selected && (
        <Modal title={ready.name} className="wide" onClose={() => { abortRef.current?.abort(); setPicker({ status: 'closed' }); }}>
          <div className="add-layout">
            <div className="add-art">
              {shownImage ? (
                <img src={shownImage} alt={`${selected.name}, ${selected.set_name} #${selected.collector_number}`} />
              ) : (
                <span className="fallback">{selected.name}</span>
              )}
              {images.back && (
                <button type="button" className="btn" onClick={() => setPicker({ ...ready, face: ready.face === 'back' ? 'front' : 'back' })}>
                  {ready.face === 'back' ? 'Show front' : 'Show back'}
                </button>
              )}
            </div>
            <div className="add-fields">
              <label className="field">
                Printing
                <select
                  value={selected.id}
                  onChange={(event) => {
                    const card = ready.cards.find((item) => item.id === event.target.value);
                    if (!card) return;
                    const nextFinish = availableFinishes(card).includes(ready.finish) ? ready.finish : defaultFinish(card);
                    setPicker({ ...ready, selectedId: card.id, finish: nextFinish, face: 'front' });
                  }}
                >
                  {optionCards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {printingLabel(card)}
                    </option>
                  ))}
                </select>
              </label>
              {ready.cards.length > 12 && (
                <label className="field">
                  Filter printings
                  <input
                    value={ready.filter}
                    placeholder="Set name, code, or collector number"
                    onChange={(event) => setPicker({ ...ready, filter: event.target.value })}
                  />
                </label>
              )}
              <p className="hint">
                {ready.cards.length.toLocaleString('en-US')} {ready.allLang ? 'printings' : 'English printings'}
                {ready.truncated ? '. This list is truncated to the newest few thousand.' : '.'}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={ready.allLang}
                  onChange={(event) => void loadPrintings(ready.name, event.target.checked)}
                />
                Include non-English printings
              </label>
              <fieldset className="segment-set">
                <legend>Finish</legend>
                <div className="segmented" role="radiogroup" aria-label="Finish">
                  {(['nonfoil', 'foil', 'etched'] as Finish[]).map((finish) => {
                    const available = finishes.includes(finish);
                    if (finish === 'etched' && !available) return null;
                    return (
                      <button
                        key={finish}
                        type="button"
                        role="radio"
                        aria-checked={ready.finish === finish}
                        disabled={!available}
                        onClick={() => setPicker({ ...ready, finish })}
                      >
                        <span>{finishLabel(finish)}</span>
                        <span>{available ? formatUsd(priceForFinish(selected, finish)) : 'Not printed'}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <div className="field">
                <span>Quantity</span>
                <QuantityInline value={ready.quantity} onChange={(quantity) => setPicker({ ...ready, quantity })} />
              </div>
              <p className="price-preview">
                Scryfall USD market price: <strong>{formatUsd(priceForFinish(selected, ready.finish))}</strong>
                {priceForFinish(selected, ready.finish) == null ? ' — no price for this finish.' : '.'}
              </p>
              {owned > 0 && <p className="hint">You already have {owned} of this printing and finish. Adding will increase that count.</p>}
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  onAdd(cardToEntry(selected, ready.finish, ready.quantity));
                  setQuery('');
                  setSuggestions([]);
                  setPicker({ status: 'closed' });
                  inputRef.current?.focus();
                }}
              >
                Add to collection
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function QuantityInline({ value, onChange }: { value: number; onChange: (quantity: number) => void }) {
  return (
    <div className="qty">
      <button type="button" aria-label="Decrease quantity" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1}>
        −
      </button>
      <input
        aria-label="Quantity to add"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          const quantity = Number(event.target.value.replace(/[^\d]/g, ''));
          if (Number.isFinite(quantity) && quantity >= 1) onChange(Math.min(9999, quantity));
        }}
      />
      <button type="button" aria-label="Increase quantity" onClick={() => onChange(Math.min(9999, value + 1))}>
        +
      </button>
    </div>
  );
}

function highlight(name: string, query: string) {
  const needle = query.trim();
  const index = name.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0 || needle.length === 0) return name;
  return (
    <>
      {name.slice(0, index)}
      <mark>{name.slice(index, index + needle.length)}</mark>
      {name.slice(index + needle.length)}
    </>
  );
}
