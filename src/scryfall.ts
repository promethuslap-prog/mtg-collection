import type { ScryfallCard, CardIdentifier } from './cards';

const API = 'https://api.scryfall.com';

// Scryfall asks browsers to keep the default User-Agent and to space requests.
// Autocomplete and search use a short gap. /cards/collection is limited to 2/second.
const GAP_SEARCH_MS = 150;
const GAP_COLLECTION_MS = 600;

export class ScryfallError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ScryfallError';
    this.status = status;
  }
}

interface ListBody<T> {
  data?: T[];
  has_more?: boolean;
  next_page?: string | null;
  not_found?: CardIdentifier[];
  details?: string;
}

let chain: Promise<void> = Promise.resolve();
let nextAt = 0;

function aborted(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function enqueue<T>(task: () => Promise<T>, gapMs: number, signal?: AbortSignal): Promise<T> {
  const run = chain.then(async () => {
    if (signal?.aborted) throw aborted();
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait, signal);
    if (signal?.aborted) throw aborted();
    nextAt = Date.now() + gapMs;
    return task();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function request(url: string, init: RequestInit, gapMs: number): Promise<Response> {
  const signal = init.signal ?? undefined;
  return enqueue(
    async () => {
      let last: Error | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (signal?.aborted) throw aborted();
        let response: Response;
        try {
          const headers: Record<string, string> = {
            Accept: 'application/json;q=0.9,*/*;q=0.8',
            // Browsers drop this forbidden header and keep their own User-Agent, which is what Scryfall asks for.
            // Node's fetch otherwise sends a library default that Scryfall rejects.
            'User-Agent': 'mtg-collection/1.0',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          };
          response = await fetch(url, {
            ...init,
            headers: { ...headers, ...init.headers },
          });
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
          await sleep(1200 * (attempt + 1), signal);
          last = new ScryfallError('Could not reach Scryfall. Check your connection and try again.', 0);
          continue;
        }
        if (response.status !== 429) return response;
        const retryAfter = Number(response.headers.get('Retry-After'));
        const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1) * 1000 + attempt * 400;
        await sleep(waitMs, signal);
        last = new ScryfallError('Scryfall asked us to slow down. Try again in a moment.', 429);
      }
      throw last ?? new ScryfallError('Scryfall rate limit', 429);
    },
    gapMs,
    signal,
  );
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function getJson<T>(url: string, gapMs: number, signal?: AbortSignal, emptyOn404 = false): Promise<T> {
  const response = await request(url, { method: 'GET', signal }, gapMs);
  if (response.status === 404 && emptyOn404) {
    return { data: [], has_more: false } as T;
  }
  const body = await readJson<T & { details?: string }>(response);
  if (!response.ok) {
    throw new ScryfallError(body?.details || `Scryfall request failed (${response.status})`, response.status);
  }
  if (!body) throw new ScryfallError('Scryfall returned an unreadable response.', response.status);
  return body;
}

export function exactNameQuery(name: string, allLanguages: boolean): string {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `!"${escaped}" unique:prints${allLanguages ? '' : ' lang:en'}`;
}

export async function autocomplete(query: string, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${API}/cards/autocomplete?q=${encodeURIComponent(q)}`;
  const body = await getJson<ListBody<string>>(url, GAP_SEARCH_MS, signal, true);
  return body.data ?? [];
}

export async function searchPrintings(
  name: string,
  allLanguages: boolean,
  signal?: AbortSignal,
): Promise<{ cards: ScryfallCard[]; truncated: boolean }> {
  const query = exactNameQuery(name, allLanguages);
  let url = `${API}/cards/search?order=released&dir=desc&unique=prints&q=${encodeURIComponent(query)}`;
  const cards: ScryfallCard[] = [];
  for (let page = 0; page < 20; page += 1) {
    const body = await getJson<ListBody<ScryfallCard>>(url, GAP_SEARCH_MS, signal, true);
    cards.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) return { cards, truncated: false };
    url = body.next_page;
  }
  return { cards, truncated: true };
}

export interface ScryfallSetInfo {
  code: string;
  name: string;
  set_type?: string;
}

export async function fetchSets(signal?: AbortSignal): Promise<ScryfallSetInfo[]> {
  let url = `${API}/sets`;
  const sets: ScryfallSetInfo[] = [];
  for (let page = 0; page < 5; page += 1) {
    const body = await getJson<ListBody<ScryfallSetInfo>>(url, GAP_SEARCH_MS, signal, false);
    sets.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) break;
    url = body.next_page;
  }
  return sets;
}

export async function searchOrdered(
  query: string,
  order = 'edhrec',
  signal?: AbortSignal,
): Promise<ScryfallCard[]> {
  const url = `${API}/cards/search?order=${encodeURIComponent(order)}&unique=cards&q=${encodeURIComponent(query)}`;
  const body = await getJson<ListBody<ScryfallCard>>(url, GAP_SEARCH_MS, signal, true);
  return body.data ?? [];
}

export async function searchByQuery(query: string, signal?: AbortSignal, maxPages = 2): Promise<ScryfallCard[]> {
  let url = `${API}/cards/search?order=released&dir=desc&unique=prints&q=${encodeURIComponent(query)}`;
  const cards: ScryfallCard[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const body = await getJson<ListBody<ScryfallCard>>(url, GAP_SEARCH_MS, signal, true);
    cards.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) break;
    url = body.next_page;
  }
  return cards;
}

export async function fetchCollection(
  identifiers: CardIdentifier[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ cards: ScryfallCard[]; notFound: CardIdentifier[] }> {
  const cards: ScryfallCard[] = [];
  const notFound: CardIdentifier[] = [];
  const total = identifiers.length;
  if (total === 0) return { cards, notFound };
  for (let index = 0; index < identifiers.length; index += 75) {
    const chunk = identifiers.slice(index, index + 75);
    const response = await request(
      `${API}/cards/collection`,
      { method: 'POST', body: JSON.stringify({ identifiers: chunk }), signal },
      GAP_COLLECTION_MS,
    );
    const body = await readJson<ListBody<ScryfallCard>>(response);
    if (!response.ok) {
      throw new ScryfallError(body?.details || `Scryfall request failed (${response.status})`, response.status);
    }
    cards.push(...(body?.data ?? []));
    notFound.push(...(body?.not_found ?? []));
    onProgress?.(Math.min(index + chunk.length, total), total);
  }
  return { cards, notFound };
}
