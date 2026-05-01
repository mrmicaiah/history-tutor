import type { KnowledgeMap } from '../../worker/src/types/knowledge-map';
import type { ReferenceCard } from '../../worker/src/types/cards';

/**
 * Lightweight observable store. Patch by top-level key (`patch('chat',...)`)
 * for shallow merging of nested objects, or replace entirely with `set`.
 *
 * Subscribers receive the new state on every change. Use `subscribeSlice`
 * (defined here, not on the class) to fire only when a specific slice's
 * reference changes — patching always produces new references for the
 * changed slice, so reference equality is a reliable change signal.
 */

type Listener<T> = (state: T) => void;

export class Store<T extends object> {
  private state: T;
  private readonly listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  set(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  patch<K extends keyof T>(key: K, slice: Partial<T[K]>): void {
    const current = this.state[key] as object;
    this.state = {
      ...this.state,
      [key]: { ...current, ...slice },
    } as T;
    this.emit();
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

/** Fire `fn` only when `selector(state)` produces a new reference. */
export function subscribeSlice<T extends object, S>(
  store: Store<T>,
  selector: (state: T) => S,
  fn: (slice: S) => void,
): () => void {
  let last = selector(store.get());
  fn(last);
  return store.subscribe((state) => {
    const next = selector(state);
    if (!Object.is(next, last)) {
      last = next;
      fn(next);
    }
  });
}

// ---------------------------------------------------------------------------
// App state shape and singleton
// ---------------------------------------------------------------------------

export type ActiveView = 'chat' | 'cards' | 'map';
export type SortMode = 'weakest' | 'newest' | 'alpha';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface AppState {
  authenticated: boolean;
  activeView: ActiveView;
  chat: {
    messages: ChatMessage[];
    sending: boolean;
    error: string | null;
    hydrated: boolean;
  };
  cards: {
    list: ReferenceCard[];
    sort: SortMode;
    loading: boolean;
    hydrated: boolean;
  };
  map: {
    data: KnowledgeMap | null;
    loading: boolean;
    summary: { text: string; updated_at_ms: number | null };
    turn_count: number;
    hydrated: boolean;
  };
  audio: {
    /**
     * When true: new tutor replies auto-play, and tapping any prior tutor
     * bubble replays it. When false: nothing plays, tapping bubbles is a
     * no-op. Persisted to localStorage as the string "true" / "false".
     */
    enabled: boolean;
  };
}

const AUDIO_STORAGE_KEY = 'audio_enabled';
const LEGACY_AUTOPLAY_KEY = 'audio_autoplay';

/**
 * Read the audio-enabled preference from localStorage. Defaults to true.
 *
 * Migrates from the Stage 6.1 `audio_autoplay` key on first load: if the
 * new key is unset and the legacy key exists, copy the value over and
 * delete the legacy key. Tolerant of privacy-mode storage failures.
 */
export function loadAudioEnabledPreference(): boolean {
  try {
    const current = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (current !== null) return current !== 'false';

    const legacy = localStorage.getItem(LEGACY_AUTOPLAY_KEY);
    if (legacy !== null) {
      const enabled = legacy !== 'false';
      localStorage.setItem(AUDIO_STORAGE_KEY, String(enabled));
      localStorage.removeItem(LEGACY_AUTOPLAY_KEY);
      return enabled;
    }
    return true;
  } catch {
    return true;
  }
}

/** Persist the audio-enabled preference. Silent on storage failure. */
export function saveAudioEnabledPreference(value: boolean): void {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, String(value));
  } catch {
    /* storage unavailable; preference will reset on next reload */
  }
}

export const app = new Store<AppState>({
  authenticated: false,
  activeView: 'chat',
  chat: {
    messages: [],
    sending: false,
    error: null,
    hydrated: false,
  },
  cards: {
    list: [],
    sort: 'weakest',
    loading: false,
    hydrated: false,
  },
  map: {
    data: null,
    loading: false,
    summary: { text: '', updated_at_ms: null },
    turn_count: 0,
    hydrated: false,
  },
  audio: {
    enabled: loadAudioEnabledPreference(),
  },
});
