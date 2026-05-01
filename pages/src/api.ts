import type { KnowledgeMap } from '../../worker/src/types/knowledge-map';
import type { ReferenceCard } from '../../worker/src/types/cards';
import type { SortMode } from './state';

/**
 * Worker API client.
 *
 * Same-origin only: all requests go to relative `/api/*` paths. In
 * production, those are served by the Pages Function proxy at
 * `pages/functions/api/[[path]].ts`, which forwards to the Worker. In
 * local dev, `wrangler pages dev` runs the same proxy with the
 * `WORKER_URL` binding pointing at `http://localhost:8787`.
 *
 * `credentials: 'include'` is preserved so the session cookie travels;
 * for same-origin requests this is the default but explicit is clearer.
 *
 * Errors are thrown as `ApiError`. Network failures use `status: 0`.
 * Views catch and render error.status / error.code / error.body.
 */

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
    response = await fetch(path, { ...init, credentials: 'include' });
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

/**
 * POST that returns a binary blob (used by /api/tts). Maps non-2xx to
 * `ApiError` with whatever JSON error envelope the Worker returned.
 */
async function postBlob(path: string, body: object): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', null);
  }
  if (!response.ok) {
    let errBody: unknown = null;
    try {
      errBody = await response.json();
    } catch {
      /* non-JSON error body */
    }
    const code =
      errBody && typeof errBody === 'object' && 'error' in errBody &&
      typeof (errBody as { error: unknown }).error === 'string'
        ? (errBody as { error: string }).error
        : 'unknown';
    throw new ApiError(response.status, code, errBody);
  }
  return response.blob();
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
  ttsAudio: (text: string) => postBlob('/api/tts', { text }),
};
