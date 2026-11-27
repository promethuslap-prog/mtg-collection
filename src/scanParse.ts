export interface CollectorHit {
  set?: string;
  number: string;
  rarity?: string;
}

const NOT_A_SET = new Set(['EN', 'THE', 'AND', 'CARD', 'ART', 'SET', 'ILLUS', 'RARITY']);

export function parseCollectorLine(raw: string): CollectorHit | null {
  const text = raw
    .toUpperCase()
    .replace(/[•·∙|«»]/g, ' ')
    .replace(/[^A-Z0-9/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  const paired = text.match(/\b([A-Z][A-Z0-9]{2,4})\s+0*(\d{1,4})(?:\s*\/\s*\d{1,4})?(?:\s+([CURMLST]))?\b/);
  if (paired && !NOT_A_SET.has(paired[1])) {
    return { set: paired[1].toLowerCase(), number: stripZeros(paired[2]), rarity: paired[3] };
  }

  const sets = [...text.matchAll(/\b([A-Z][A-Z0-9]{2,4})\b/g)]
    .map((match) => match[1])
    .filter((code) => !NOT_A_SET.has(code) && /[A-Z]/.test(code) && /\d|[A-Z]{3}/.test(code));
  const numbers = [...text.matchAll(/\b0*(\d{1,4})\b/g)].map((match) => stripZeros(match[1])).filter((value) => Number(value) > 0 && Number(value) < 1000);
  const rarity = text.match(/\b([CURMLST])\b/)?.[1];
  if (sets.length > 0 && numbers.length > 0) {
    const set = sets.find((code) => /\d/.test(code)) ?? sets[sets.length - 1];
    return { set: set.toLowerCase(), number: numbers[0], rarity };
  }

  const fraction = text.match(/\b0*(\d{1,4})\s*\/\s*\d{1,4}(?:\s+([CURMLST]))?\b/);
  if (fraction) return { number: stripZeros(fraction[1]), rarity: fraction[2] };
  return null;
}

export function cleanOcrName(raw: string): string {
  const lines = raw.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const best = [...lines].sort((a, b) => letters(b) - letters(a))[0] ?? '';
  return best
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9 ,'\u2019-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCardName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function nameSimilarity(left: string, right: string): number {
  const a = normalizeCardName(left);
  const b = normalizeCardName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const at = new Set(a.split(' ').filter((word) => word.length > 1));
  const bt = new Set(b.split(' ').filter((word) => word.length > 1));
  let shared = 0;
  for (const word of at) if (bt.has(word)) shared += 1;
  const dice = at.size + bt.size === 0 ? 0 : (2 * shared) / (at.size + bt.size);
  const distance = levenshtein(a, b);
  const edit = 1 - distance / Math.max(a.length, b.length);
  return Math.max(dice, edit);
}

export function namesAgree(ocrName: string, cardName: string): boolean {
  if (!ocrName.trim()) return true;
  return nameSimilarity(ocrName, cardName) >= 0.55;
}

export interface RecognitionChoice {
  source: 'set-number' | 'fuzzy' | 'autocomplete';
  name: string;
  confidence: number;
}

export function chooseRecognition(input: {
  ocrName: string;
  collector: CollectorHit | null;
  setName: string | null;
  fuzzyName: string | null;
  autocomplete: string[];
}): RecognitionChoice | null {
  const ocrName = input.ocrName.trim();
  if (input.collector?.set && input.setName && namesAgree(ocrName, input.setName)) {
    const similarity = ocrName ? nameSimilarity(ocrName, input.setName) : 0.82;
    return { source: 'set-number', name: input.setName, confidence: Math.max(0.84, similarity) };
  }
  if (input.fuzzyName) {
    const similarity = nameSimilarity(ocrName, input.fuzzyName);
    if (similarity >= 0.62) return { source: 'fuzzy', name: input.fuzzyName, confidence: similarity };
  }
  const best = input.autocomplete
    .map((name) => ({ name, similarity: nameSimilarity(ocrName, name) }))
    .sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name))[0];
  if (best && best.similarity >= 0.72) {
    return { source: 'autocomplete', name: best.name, confidence: Math.round(best.similarity * 0.9 * 100) / 100 };
  }
  if (input.collector?.set && input.setName && !ocrName) {
    return { source: 'set-number', name: input.setName, confidence: 0.8 };
  }
  return null;
}

export function collectorNumberVariants(number: string): string[] {
  const stripped = stripZeros(number);
  return stripped === number ? [number] : [stripped, number];
}

function stripZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, '');
}

function letters(value: string): number {
  return value.replace(/[^A-Za-z]/g, '').length;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length];
}
