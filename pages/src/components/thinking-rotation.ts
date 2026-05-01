import { THINKING_MESSAGES } from '../data/messages';

/**
 * Rotation driver for the chat view's thinking indicator.
 *
 * Picks a random message from `THINKING_MESSAGES` immediately (no fade-in
 * for the first one — it's already there when she looks). Then every
 * 12-18 seconds: fade out (300ms via CSS opacity transition), swap text,
 * fade in (300ms). Never repeats the previous message.
 *
 * The 12-18s pacing was chosen carefully — slow on purpose so the rotation
 * feels like a quiet voice in the room rather than a nervous tic. Don't
 * speed it up.
 *
 * Returns a cleanup function that clears any pending timer. The chat view
 * calls it when `chat.sending` flips back to false. CSS handles the fade
 * via the `transition: opacity 300ms ease-out` rule on `.thinking-message`.
 */
export function startThinkingRotation(target: HTMLElement): () => void {
  const ROTATE_MIN_MS = 12_000;
  const ROTATE_RANGE_MS = 6_000;
  const FADE_MS = 300;

  let lastIndex = -1;
  let pendingTimer: number | null = null;

  function pickNew(): string {
    let idx = Math.floor(Math.random() * THINKING_MESSAGES.length);
    while (idx === lastIndex && THINKING_MESSAGES.length > 1) {
      idx = Math.floor(Math.random() * THINKING_MESSAGES.length);
    }
    lastIndex = idx;
    return THINKING_MESSAGES[idx]!;
  }

  // First message: shown immediately, no fade-in.
  target.textContent = pickNew();
  target.style.opacity = '1';

  function scheduleNext(): void {
    const delay = ROTATE_MIN_MS + Math.floor(Math.random() * ROTATE_RANGE_MS);
    pendingTimer = (setTimeout as typeof window.setTimeout)(() => {
      target.style.opacity = '0';
      pendingTimer = (setTimeout as typeof window.setTimeout)(() => {
        target.textContent = pickNew();
        target.style.opacity = '1';
        scheduleNext();
      }, FADE_MS) as unknown as number;
    }, delay) as unknown as number;
  }

  scheduleNext();

  return () => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };
}
