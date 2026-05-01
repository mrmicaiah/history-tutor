import { app } from '../state';
import { api, ApiError } from '../api';
import { clearChildren, el, on } from '../lib/dom';

/**
 * PIN gate view. Single-column, focused entry. Shows server-side errors
 * (wrong PIN, rate limit) inline. On success, flips `state.authenticated`
 * — `main.ts` re-renders to AppShell.
 */
export function PinGateView(): HTMLElement {
  const container = el('section', { class: 'view pin-gate active' });
  const title = el('h1', { class: 'app-title' }, 'history-tutor');
  const subtitle = el('p', { class: 'pin-subtitle' }, 'Enter your PIN to start a session.');

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
