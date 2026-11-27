import type { ScryfallCard } from './cards';
import { autocomplete, fetchCardBySetNumber, fetchNamedFuzzy, searchByQuery } from './scryfall';
import { chooseRecognition, cleanOcrName, collectorNumberVariants, parseCollectorLine } from './scanParse';

export interface ScanHit {
  card: ScryfallCard;
  confidence: number;
  source: 'set-number' | 'fuzzy' | 'autocomplete';
}

export async function resolveOcr(nameText: string, collectorText: string, signal?: AbortSignal): Promise<ScanHit | null> {
  const ocrName = cleanOcrName(nameText);
  const collector = parseCollectorLine(collectorText);
  const bySet = collector?.set && collector.number ? await fetchCardBySetNumber(collector.set, collector.number, signal) : null;
  const agreed = chooseRecognition({
    ocrName,
    collector,
    setName: bySet?.name ?? null,
    fuzzyName: null,
    autocomplete: [],
  });
  if (agreed?.source === 'set-number' && bySet) {
    return { card: bySet, confidence: agreed.confidence, source: 'set-number' };
  }
  if (ocrName.length < 3) {
    return bySet ? { card: bySet, confidence: 0.7, source: 'set-number' } : null;
  }
  const fuzzy = await fetchNamedFuzzy(ocrName, signal);
  const named = chooseRecognition({
    ocrName,
    collector,
    setName: bySet?.name ?? null,
    fuzzyName: fuzzy?.name ?? null,
    autocomplete: [],
  });
  if (named?.source === 'fuzzy' && fuzzy) {
    const card = await printingForNumber(fuzzy, collector?.number, signal);
    return { card, confidence: named.confidence, source: 'fuzzy' };
  }
  const suggestions = await autocomplete(ocrName, signal);
  const picked = chooseRecognition({
    ocrName,
    collector,
    setName: bySet?.name ?? null,
    fuzzyName: fuzzy?.name ?? null,
    autocomplete: suggestions,
  });
  if (picked?.source === 'autocomplete') {
    const card = await fetchNamedFuzzy(picked.name, signal);
    if (card) return { card: await printingForNumber(card, collector?.number, signal), confidence: picked.confidence, source: 'autocomplete' };
  }
  if (picked?.source === 'set-number' && bySet) return { card: bySet, confidence: picked.confidence, source: 'set-number' };
  return bySet ? { card: bySet, confidence: 0.66, source: 'set-number' } : null;
}

async function printingForNumber(card: ScryfallCard, number: string | undefined, signal?: AbortSignal): Promise<ScryfallCard> {
  if (!number) return card;
  const wanted = new Set(collectorNumberVariants(number));
  if (wanted.has(card.collector_number)) return card;
  const query = `!"${card.name.replace(/"/g, '')}" (${[...wanted].map((value) => `cn:${value}`).join(' OR ')})`;
  const found = await searchByQuery(query, signal, 1);
  return found.find((item) => wanted.has(item.collector_number) || wanted.has(item.collector_number.replace(/^0+(?=\d)/, ''))) ?? card;
}
