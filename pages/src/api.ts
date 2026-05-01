import type { KnowledgeMap } from '../../worker/src/types/knowledge-map';
import type { ReferenceCard } from '../../worker/src/types/cards';
import type { SortMode } from './state';

/**
 * Worker API client.
 *
 * Every request uses `credentials: 'include'` so the session cookie travels.
 * `API_BASE` resolution order:
 *   1. `window.API_BASE` if defined (set in index.html for production).
 *   2. `http://localhost:8787` when on localhost (matches `wrangler dev`).
 *   3. Empty string (same-origin) — for setups proxying /api through Pages.
 *
 * Errors are thrown as `ApiError`. Network failures use `status: 0`.
 * Views catch and render error.status / error.code / error.body.
 */

declare global {
  interface Window {
    API_BASE?: string;
  }
}

const API_BASE: string = (() => {
  if (typeof window !== 'undefined' && typeof window.API_BASE === 'string') {
    return window.API_BASE;
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:8787';
  }
  return '';
})();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  constructor(status: number, code: string, body: unknown) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_BASE + path, { ...init, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'network', null);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* empty / non-json response */
  }
  if (!response.ok) {
    const code = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
      ? (body as { error: string }).error
      : 'unknown';
    throw new ApiError(response.status, code, body);
  }
  return body as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' });
const post = <T>(path: string, body: object): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const patch = <T>(path: string, body: object): Promise<T> =>
  request<T>(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function qs<T extends object>(params: T): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s.length > 0 ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface AuthStatus {
  authenticated: boolean;
}

export interface StateResponse {
  map: KnowledgeMap;
  summary: {
    text: string;
    last_compacted_turn_id: number | null;
    updated_at_ms: number | null;
  };
  turn_count: number;
  recent_turns: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
}

export interface CardsResponse {
  cards: ReferenceCard[];
  total: number;
  has_more: boolean;
}

export interface ChatResponse {
  reply: string;
}

export interface CardPatchResponse {
  card: ReferenceCard;
}

export interface CardsQueryParams {
  sort?: SortMode;
  limit?: number;
  offset?: number;
  category?: string;
  era?: string;
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

export const api = {
  authStatus: () => get<AuthStatus>('/api/auth/status'),
  submitPin: (pin: string) => post<{ ok: true }>('/api/auth/pin', { pin }),
  sendMessage: (message: string) => post<ChatResponse>('/api/chat', { message }),
  getState: () => get<StateResponse>('/api/state'),
  getCards: (params: CardsQueryParams = {}) =>
    get<CardsResponse>(`/api/cards${qs(params)}`),
  updateCardMastery: (id: number, mastery: number) =>
    patch<CardPatchResponse>(`/api/cards/${id}`, { mastery }),
};
