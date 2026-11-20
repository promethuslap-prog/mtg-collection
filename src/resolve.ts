import { availableFinishes, cardNameList, cardToEntry, type CardIdentifier, type ScryfallCard } from './cards';
import { groupDeckLines, type DeckGroup, type ParsedLine } from './decklist';
import { fetchCollection } from './scryfall';
import { normalizeName } from './text';
import { finishLabel } from './format';
import { combineEntries } from './collection';
import type { CollectionEntry } from './types';

export interface ResolveResult {
  entries: CollectionEntry[];
  missing: Array<{ lineNumbers: number[]; name: string }>;
  warnings: string[];
}

function identifierFor(group: DeckGroup): CardIdentifier {
  if (group.set && group.collectorNumber) {
    return { set: group.set.toLowerCase(), collector_number: group.collectorNumber };
  }
  if (group.set) return { name: group.name, set: group.set.toLowerCase() };
  return { name: group.name };
}

function identKey(identifier: CardIdentifier): string {
  return [identifier.id ?? '', identifier.set ?? '', identifier.collector_number ?? '', normalizeName(identifier.name ?? '')].join('|');
}

function sameName(card: ScryfallCard, name: string): boolean {
  const target = normalizeName(name);
  return cardNameList(card).some((cardName) => normalizeName(cardName) === target);
}

function matchCard(group: DeckGroup, cards: ScryfallCard[]): ScryfallCard | undefined {
  return cards.find((card) => {
    if (group.set && group.collectorNumber) {
      return (
        card.set.toLowerCase() === group.set.toLowerCase() &&
        card.collector_number.toLowerCase() === group.collectorNumber.toLowerCase()
      );
    }
    if (group.set) return sameName(card, group.name) && card.set.toLowerCase() === group.set.toLowerCase();
    return sameName(card, group.name);
  });
}

export async function resolveDecklist(
  lines: ParsedLine[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ResolveResult> {
  const groups = groupDeckLines(lines);
  const identifiers = new Map<string, CardIdentifier>();
  for (const group of groups) {
    const identifier = identifierFor(group);
    identifiers.set(identKey(identifier), identifier);
  }
  const { cards } = await fetchCollection([...identifiers.values()], onProgress, signal);
  const entries: CollectionEntry[] = [];
  const missing: ResolveResult['missing'] = [];
  const warnings: string[] = [];
  const addedAt = Date.now();

  for (const group of groups) {
    const card = matchCard(group, cards);
    if (!card) {
      missing.push({ lineNumbers: group.lineNumbers, name: group.name });
      continue;
    }
    const finishes = availableFinishes(card);
    const finish = finishes.includes(group.finish) ? group.finish : finishes[0];
    if (finish !== group.finish) {
      warnings.push(`${group.name}: this printing has no ${finishLabel(group.finish).toLowerCase()} version, so it was saved as ${finishLabel(finish).toLowerCase()}.`);
    }
    entries.push(cardToEntry(card, finish, group.quantity, addedAt));
  }

  return { entries: combineEntries(entries), missing, warnings };
}
