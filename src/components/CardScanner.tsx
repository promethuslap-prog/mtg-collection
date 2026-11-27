import { useEffect, useRef, useState } from 'react';
import { availableFinishes, cardImages, cardToEntry, type ScryfallCard } from '../cards';
import { autocomplete, searchPrintings } from '../scryfall';
import { resolveOcr, type ScanHit } from '../scanResolve';
import { scannedEntryId } from '../scanExport';
import { normalizeName } from '../text';
import type { CollectionEntry, Finish } from '../types';

const CONDITIONS = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];
const LANGUAGES = ['en', 'ja', 'de', 'fr', 'es', 'it', 'pt', 'ko', 'zhs', 'zht', 'ru'];

interface TrayItem {
  id: string;
  card: ScryfallCard;
  qty: number;
  finish: Finish;
  condition: string;
  language: string;
  moxfieldCopies: number;
  confirmExtra: boolean;
  confidence: number;
}

interface CardScannerProps {
  entries: CollectionEntry[];
  onClose: () => void;
  onCommit: (entries: CollectionEntry[]) => void;
}

export function CardScanner({ entries, onClose, onCommit }: CardScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busy = useRef(false);
  const lastId = useRef<string | null>(null);
  const streak = useRef(0);
  const held = useRef<string | null>(null);
  const misses = useRef(0);
  const [cameraError, setCameraError] = useState('');
  const [status, setStatus] = useState('Starting the camera…');
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [alternates, setAlternates] = useState<{ id: string; cards: ScryfallCard[]; query: string } | null>(null);
  useEffect(() => {
    let stop = false;
    const video = videoRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser blocked the live camera. Take a photo or upload one instead.');
      setStatus('Upload a photo of one card.');
      return undefined;
    }
    void navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then((stream) => {
      if (stop) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      }
      setStatus('Line the card up in the frame.');
    }).catch(() => {
      setCameraError('This browser blocked the live camera. Take a photo or upload one instead.');
      setStatus('Upload a photo of one card.');
    });
    return () => {
      stop = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (cameraError) return undefined;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        const video = videoRef.current;
        if (video && video.videoWidth > 0 && video.readyState >= 2 && !busy.current) {
          busy.current = true;
          try {
            await consider(frameFromVideo(video), false);
          } catch (error) {
            console.warn(error);
            setStatus('Could not read that frame. Hold the card steady or use Capture.');
          } finally {
            busy.current = false;
          }
        }
        await wait(350);
      }
    };
    void loop();
    return () => {
      stop = true;
    };
  }, [cameraError, entries]);

  async function consider(source: CanvasImageSource, manual: boolean) {
    setStatus(manual ? 'Reading that photo…' : 'Looking…');
    const { readCardImage } = await import('../scanOcr');
    const read = await readCardImage(source);
    const hit = await resolveOcr(read.nameText, read.collectorText);
    if (!hit) {
      streak.current = 0;
      lastId.current = null;
      if (!manual) noteMiss();
      setStatus('No card read yet. Fill the frame with one card.');
      return;
    }
    const threshold = manual ? 0.62 : 0.8;
    if (hit.confidence < threshold) {
      streak.current = 0;
      lastId.current = null;
      setStatus(`Maybe ${hit.card.name}. Hold it steady, or press Capture.`);
      return;
    }
    if (!manual) {
      if (hit.card.id === held.current) {
        setStatus(`${hit.card.name} is already in the tray. Move to the next card.`);
        return;
      }
      if (hit.card.id === lastId.current) streak.current += 1;
      else {
        streak.current = 1;
        lastId.current = hit.card.id;
      }
      setStatus(`Seeing ${hit.card.name}…`);
      if (streak.current < 2) return;
      held.current = hit.card.id;
      streak.current = 0;
      misses.current = 0;
    }
    pushHit(hit);
    signalFound();
    setStatus(`Added ${hit.card.name}.`);
  }

  function noteMiss() {
    if (!held.current) return;
    misses.current += 1;
    if (misses.current >= 2) {
      held.current = null;
      lastId.current = null;
      streak.current = 0;
    }
  }

  function pushHit(hit: ScanHit) {
    const copies = moxfieldCopies(entries, hit.card.name);
    setTray((current) => {
      const existing = current.find((item) => item.card.id === hit.card.id);
      if (existing) return current.map((item) => item.card.id === hit.card.id ? { ...item, qty: Math.min(99, item.qty + 1) } : item);
      const finishes = availableFinishes(hit.card);
      return [...current, {
        id: hit.card.id,
        card: hit.card,
        qty: 1,
        finish: finishes.includes('nonfoil') ? 'nonfoil' : finishes[0] ?? 'nonfoil',
        condition: 'Near Mint',
        language: hit.card.lang || 'en',
        moxfieldCopies: copies,
        confirmExtra: false,
        confidence: hit.confidence,
      }];
    });
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const image = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    await consider(canvas, true);
  }

  async function showAlternates(item: TrayItem) {
    const cards = (await searchPrintings(item.card.name, true, undefined, 1)).cards;
    setAlternates({ id: item.id, cards, query: '' });
  }

  async function searchAlternate(query: string) {
    if (!alternates) return;
    setAlternates({ ...alternates, query });
    const names = await autocomplete(query);
    if (!names[0]) return;
    const cards = (await searchPrintings(names[0], true, undefined, 1)).cards;
    setAlternates({ id: alternates.id, cards, query });
  }

  function commit() {
    const accepted = tray.filter((item) => item.moxfieldCopies === 0 || item.confirmExtra);
    if (accepted.length === 0) {
      setStatus('Confirm any cards that are already in Moxfield, or scan a new one.');
      return;
    }
    const now = Date.now();
    onCommit(accepted.map((item) => {
      const entry = cardToEntry(item.card, item.finish, item.qty, now);
      return {
        ...entry,
        source: 'scanned' as const,
        condition: item.condition,
        language: item.language,
        scannedAt: now,
        id: scannedEntryId(item.card.id, item.finish, item.language),
      };
    }));
    setTray([]);
    held.current = null;
  }

  const scanned = tray;
  return (
    <section className="scanner" data-scanner>
      <div className="row-actions">
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn primary" onClick={commit} disabled={scanned.length === 0}>Add all to collection</button>
      </div>
      <h2>Scan cards</h2>
      <p className="hint">Point the rear camera at one card, or upload a photo. Nothing is saved until you add the tray. Moxfield is not changed.</p>
      {cameraError && <p role="alert">{cameraError}</p>}
      <div className={cameraError ? 'scan-stage scan-stage-hidden' : 'scan-stage'}>
        <video ref={videoRef} playsInline muted autoPlay data-scan-video />
        {!cameraError && <div className="scan-guide" aria-hidden="true" />}
      </div>
      <p role="status" data-scan-status>{status}</p>
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const video = videoRef.current;
            if (!video || video.readyState < 2) return;
            void consider(frameFromVideo(video), true);
          }}
        >
          Capture
        </button>
        <label className="btn file-btn">
          Upload photo
          <input
            aria-label="Upload a card photo"
            data-scan-file
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void onFile(file);
            }}
          />
        </label>
      </div>
      <ul className="scan-tray" data-scan-tray>
        {scanned.map((item) => {
          const image = cardImages(item.card).front ?? '';
          return (
            <li key={item.id} data-scan-card={item.card.name}>
              {image ? <img src={image} alt="" /> : <span className="fallback">{item.card.name}</span>}
              <div>
                <strong>{item.card.name}</strong>
                <p className="muted">{item.card.set.toUpperCase()} #{item.card.collector_number}</p>
                {item.moxfieldCopies > 0 && (
                  <p className="hint">Already in your Moxfield list ({item.moxfieldCopies} {item.moxfieldCopies === 1 ? 'copy' : 'copies'}).</p>
                )}
                {item.moxfieldCopies > 0 && (
                  <label className="check">
                    <input type="checkbox" checked={item.confirmExtra} onChange={(event) => update(item.id, { confirmExtra: event.target.checked })} />
                    Add as an extra copy
                  </label>
                )}
                <div className="row-actions">
                  <button type="button" className="btn" onClick={() => update(item.id, { qty: Math.max(1, item.qty - 1) })} aria-label={`Fewer ${item.card.name}`}>−</button>
                  <span>{item.qty}</span>
                  <button type="button" className="btn" onClick={() => update(item.id, { qty: Math.min(99, item.qty + 1) })} aria-label={`More ${item.card.name}`}>+</button>
                  <select aria-label={`Finish for ${item.card.name}`} value={item.finish} onChange={(event) => update(item.id, { finish: event.target.value as Finish })}>
                    {(availableFinishes(item.card).length ? availableFinishes(item.card) : [item.finish]).map((finish) => <option key={finish} value={finish}>{finish}</option>)}
                  </select>
                  <select aria-label={`Condition for ${item.card.name}`} value={item.condition} onChange={(event) => update(item.id, { condition: event.target.value })}>
                    {CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}
                  </select>
                  <select aria-label={`Language for ${item.card.name}`} value={item.language} onChange={(event) => update(item.id, { language: event.target.value })}>
                    {LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
                  </select>
                  <button type="button" className="btn" onClick={() => void showAlternates(item)}>Wrong card?</button>
                  <button type="button" className="btn" onClick={() => setTray((current) => current.filter((entry) => entry.id !== item.id))}>Remove</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {alternates && (
        <div className="scan-alternates">
          <label className="field">Search a different name
            <input value={alternates.query} onChange={(event) => void searchAlternate(event.target.value)} />
          </label>
          <ul>
            {alternates.cards.slice(0, 12).map((card) => (
              <li key={card.id}>
                <button type="button" className="btn" onClick={() => {
                  setTray((current) => current.map((item) => item.id === alternates.id ? { ...item, id: card.id, card, moxfieldCopies: moxfieldCopies(entries, card.name) } : item));
                  setAlternates(null);
                }}>
                  {card.name} · {card.set.toUpperCase()} #{card.collector_number}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" onClick={() => setAlternates(null)}>Close</button>
        </div>
      )}
    </section>
  );

  function update(id: string, patch: Partial<TrayItem>) {
    setTray((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
}

function moxfieldCopies(entries: CollectionEntry[], name: string): number {
  const key = normalizeName(name);
  return entries.filter((entry) => entry.source === 'moxfield' && normalizeName(entry.name) === key).reduce((sum, entry) => sum + entry.quantity, 0);
}

function signalFound() {
  try {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = 880;
    gain.gain.value = 0.05;
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.12);
    void context.close();
  } catch {
    /* a beep is optional */
  }
  navigator.vibrate?.(70);
}

function frameFromVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 672;
  canvas.height = 936;
  const context = canvas.getContext('2d');
  if (!context || !video.videoWidth) return canvas;
  const viewW = video.clientWidth || video.videoWidth;
  const viewH = video.clientHeight || video.videoHeight;
  const scale = Math.max(viewW / video.videoWidth, viewH / video.videoHeight);
  const offsetX = (video.videoWidth * scale - viewW) / 2;
  const offsetY = (video.videoHeight * scale - viewH) / 2;
  const guideW = Math.min(viewW * 0.78, 360);
  const guideH = guideW * (88 / 63);
  const sx = ((viewW - guideW) / 2 + offsetX) / scale;
  const sy = ((viewH - guideH) / 2 + offsetY) / scale;
  context.drawImage(video, sx, sy, guideW / scale, guideH / scale, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    image.src = url;
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
