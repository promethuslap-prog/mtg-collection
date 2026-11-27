import { createWorker, type Worker } from 'tesseract.js';

const TITLE_CROPS = [
  { x: 0.08, y: 0.03, w: 0.62, h: 0.09 },
  { x: 0.06, y: 0.045, w: 0.68, h: 0.07 },
];
const COLLECTOR_CROPS = [
  { x: 0.04, y: 0.93, w: 0.42, h: 0.055 },
  { x: 0.03, y: 0.915, w: 0.5, h: 0.07 },
];

export interface OcrRead {
  nameText: string;
  nameConfidence: number;
  collectorText: string;
}

let workerPromise: Promise<Worker> | null = null;

export function loadOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function readCardImage(source: CanvasImageSource): Promise<OcrRead> {
  const worker = await loadOcrWorker();
  let nameText = '';
  let nameConfidence = 0;
  for (const box of TITLE_CROPS) {
    const read = await worker.recognize(boostCrop(source, box));
    if (read.data.confidence > nameConfidence && read.data.text.replace(/[^A-Za-z]/g, '').length >= 6) {
      nameText = read.data.text;
      nameConfidence = read.data.confidence;
    }
  }
  const collectorParts: string[] = [];
  for (const box of COLLECTOR_CROPS) {
    const read = await worker.recognize(boostCrop(source, box));
    if (read.data.text.trim()) collectorParts.push(read.data.text);
  }
  return { nameText, nameConfidence, collectorText: collectorParts.join('\n') };
}

function boostCrop(source: CanvasImageSource, box: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const width = sourceWidth(source);
  const height = sourceHeight(source);
  const sx = Math.max(0, Math.round(width * box.x));
  const sy = Math.max(0, Math.round(height * box.y));
  const sw = Math.max(1, Math.min(width - sx, Math.round(width * box.w)));
  const sh = Math.max(1, Math.min(height - sy, Math.round(height * box.h)));
  const canvas = document.createElement('canvas');
  canvas.width = sw * 3;
  canvas.height = sh * 3;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  let min = 255;
  let max = 0;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.3 + data[index + 1] * 0.59 + data[index + 2] * 0.11;
    data[index] = gray;
    data[index + 1] = gray;
    data[index + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const span = Math.max(1, max - min);
  for (let index = 0; index < data.length; index += 4) {
    const stretched = ((data[index] - min) * 255) / span;
    const boosted = Math.max(0, Math.min(255, (stretched - 128) * 1.35 + 128));
    data[index] = boosted;
    data[index + 1] = boosted;
    data[index + 2] = boosted;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function sourceWidth(source: CanvasImageSource): number {
  if (source instanceof HTMLVideoElement) return source.videoWidth;
  if (source instanceof HTMLImageElement) return source.naturalWidth;
  if (source instanceof HTMLCanvasElement) return source.width;
  return 0;
}

function sourceHeight(source: CanvasImageSource): number {
  if (source instanceof HTMLVideoElement) return source.videoHeight;
  if (source instanceof HTMLImageElement) return source.naturalHeight;
  if (source instanceof HTMLCanvasElement) return source.height;
  return 0;
}
