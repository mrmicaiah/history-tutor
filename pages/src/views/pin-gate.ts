import { app } from '../state';
import { api, ApiError } from '../api';
import { clearChildren, el, on } from '../lib/dom';
import { WELCOME_MESSAGES } from '../data/messages';

/**
 * PIN gate view. Single-column, focused entry. Shows server-side errors
 * (wrong PIN, rate limit) inline. On success, flips `state.authenticated`
 * — `main.ts` re-renders to AppShell.
 *
 * Above the input, one randomly-selected welcome message from
 * `data/messages.ts` is displayed in italic serif. Picked once per mount.
 * Reload to roll a new one.
 */
export function PinGateView(): HTMLElement {
  const container = el('section', { class: 'view pin-gate active' });
  const title = el('h1', { class: 'app-title' }, 'history-tutor');
  const subtitle = el('p', { class: 'welcome-message personal-message' }, pickWelcomeMessage());

  const form = el('form', { class: 'pin-form' });
  const input = el('input', {
    type: 'tel',
    inputMode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'one-time-code',
    placeholder: '••••',
    className: 'pin-input',
    maxLength: 12,
    autofocus: true,
  });
  const submit = el('button', { type: 'submit', className: 'pin-submit' }, 'Enter');
  form.append(input, submit);
  const error = el('p', { class: 'pin-error', role: 'alert' });
  container.append(title, subtitle, form, error);

  on(form, 'submit', async (event) => {
    event.preventDefault();
    const pin = input.value.trim();
    if (pin.length === 0) return;
    clearChildren(error);
    submit.disabled = true;
    try {
      await api.submitPin(pin);
      app.set({ authenticated: true });
    } catch (err) {
      error.textContent = explainAuthError(err);
      input.value = '';
      input.focus();
    } finally {
      submit.disabled = false;
    }
  });

  // Defer focus until appended to DOM.
  queueMicrotask(() => input.focus());

  return container;
}

function explainAuthError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (err.status === 0) return "Couldn't reach the server. Check your connection and try again.";
  if (err.status === 401) return 'Wrong PIN.';
  if (err.status === 429) {
    const retry = retryAfterSeconds(err.body);
    if (retry !== null) return `Too many attempts. Try again in ${retry} second${retry === 1 ? '' : 's'}.`;
    return 'Too many attempts. Try again shortly.';
  }
  return 'Something went wrong. Please try again.';
}

function retryAfterSeconds(body: unknown): number | null {
  if (body !== null && typeof body === 'object' && 'retry_after_seconds' in body) {
    const v = (body as { retry_after_seconds: unknown }).retry_after_seconds;
    if (typeof v === 'number') return v;
  }
  return null;
}

/**
 * Pick one welcome message at random. Defensive fallback for the (impossible)
 * empty-pool case so the gate still has *some* line of copy above the input.
 */
function pickWelcomeMessage(): string {
  if (WELCOME_MESSAGES.length === 0) return 'Welcome back.';
  const idx = Math.floor(Math.random() * WELCOME_MESSAGES.length);
  return WELCOME_MESSAGES[idx]!;
}
