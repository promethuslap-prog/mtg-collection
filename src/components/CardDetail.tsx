import { useState } from 'react';
import { finishLabel, formatUsd, priceLabel, rarityLabel } from '../format';
import { unitPrice } from '../collection';
import type { CollectionEntry } from '../types';
import { Modal } from './Modal';
import { Pips, rarityClass } from './bits';
import { Quantity } from './Quantity';

interface CardDetailProps {
  entry: CollectionEntry;
  onClose: () => void;
  onQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
}

export function CardDetail({ entry, onClose, onQuantity, onRemove }: CardDetailProps) {
  const [face, setFace] = useState<'front' | 'back'>('front');
  const src = face === 'back' && entry.imageBack ? entry.imageBack : entry.image;
  const alt = `${entry.name} (${entry.set.toUpperCase()} #${entry.collectorNumber})`;

  return (
    <Modal title={entry.name} onClose={onClose}>
      <div className="add-layout">
        <div className="add-art">
          {src ? <img src={src} alt={alt} /> : <span className="fallback">{entry.name}</span>}
          {entry.imageBack && (
            <button type="button" className="btn" onClick={() => setFace((current) => (current === 'back' ? 'front' : 'back'))}>
              {face === 'back' ? 'Show front' : 'Show back'}
            </button>
          )}
        </div>
        <div className="detail-copy">
          <p className="type-line">{entry.typeLine}</p>
          <p>
            <Pips colors={entry.colorIdentity} />
          </p>
          <dl>
            <div>
              <dt>Set</dt>
              <dd>
                {entry.setName || 'Unknown set'} ({entry.set.toUpperCase() || '—'}) #{entry.collectorNumber || '—'}
              </dd>
            </div>
            <div>
              <dt>Rarity</dt>
              <dd className={rarityClass(entry.rarity)}>{rarityLabel(entry.rarity)}</dd>
            </div>
            <div>
              <dt>Finish</dt>
              <dd>{finishLabel(entry.finish)}</dd>
            </div>
            {entry.condition && (
              <div>
                <dt>Condition</dt>
                <dd>{entry.condition}</dd>
              </div>
            )}
            {entry.fromTcgplayer && (
              <div>
                <dt>Source</dt>
                <dd>TCGplayer</dd>
              </div>
            )}
            <div>
              <dt>Market price</dt>
              <dd>
                {priceLabel(entry)}
                <span className="hint block">Scryfall USD{unitPrice(entry) == null ? ', no price for this finish' : ''}.</span>
              </dd>
            </div>
            {entry.finish !== 'nonfoil' && entry.priceUsd != null && (
              <div>
                <dt>Nonfoil price</dt>
                <dd>{formatUsd(entry.priceUsd)}</dd>
              </div>
            )}
            {entry.artist && (
              <div>
                <dt>Artist</dt>
                <dd>{entry.artist}</dd>
              </div>
            )}
          </dl>
          <div className="field">
            <span>Quantity</span>
            <Quantity value={entry.quantity} onChange={(quantity) => onQuantity(entry.id, quantity)} />
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                onRemove(entry.id);
                onClose();
              }}
            >
              Remove
            </button>
            {entry.scryfallUri && (
              <a className="btn" href={entry.scryfallUri} target="_blank" rel="noreferrer">
                View on Scryfall
              </a>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
