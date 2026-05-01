import { app, subscribeSlice, type ChatMessage } from '../state';
import { api, ApiError } from '../api';
import { clearChildren, el, on } from '../lib/dom';

/**
 * Chat view: scrollable transcript on top, sticky composer at bottom.
 * Tutor messages have no chrome — just typography. User messages get a
 * subtle bubble to mark side. Plain text only (the tutor prompt forbids
 * markdown anyway). Auto-scrolls to bottom on new content.
 *
 * Hydrates from `GET /api/state.recent_turns` on first mount via the
 * shared hydration helper in `main.ts`.
 */

export function ChatView(): HTMLElement {
  const view = el('section', { class: 'view chat-view' });
  const messagesEl = el('div', { class: 'chat-messages' });
  const composer = ChatComposer();
  view.append(messagesEl, composer);

  subscribeSlice(app, (s) => s.chat, (chat) => {
    renderMessages(messagesEl, chat.messages, chat.sending, chat.error);
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  });

  return view;
}

function renderMessages(
  container: HTMLElement,
  messages: ChatMessage[],
  sending: boolean,
  error: string | null,
): void {
  clearChildren(container);
  if (messages.length === 0 && !sending) {
    container.appendChild(
      el('div', { class: 'chat-empty' },
        el('p', null,
          "Ready when you are. Ask anything you want to study, or just say where you'd like to start.",
        ),
      ),
    );
    return;
  }
  for (const msg of messages) {
    container.appendChild(MessageBubble(msg));
  }
  if (sending) {
    container.appendChild(el('div', { class: 'chat-thinking' }, 'Thinking…'));
  }
  if (error !== null) {
    container.appendChild(el('div', { class: 'chat-error' }, error));
  }
}

function MessageBubble(msg: ChatMessage): HTMLElement {
  return el(
    'article',
    { class: msg.role === 'user' ? 'msg msg-user' : 'msg msg-tutor' },
    el('div', { class: 'msg-content' }, msg.content),
  );
}

function ChatComposer(): HTMLElement {
  const form = el('form', { class: 'chat-composer' });
  const textarea = el('textarea', {
    className: 'chat-input',
    placeholder: 'Type a message…',
    rows: 1,
    autocapitalize: 'sentences',
  });
  const send = el('button', { type: 'submit', className: 'chat-send' }, 'Send');

  function autosize(): void {
    textarea.style.height = 'auto';
    const max = 6 * 24; // ~6 lines at 24px line-height
    textarea.style.height = Math.min(max, textarea.scrollHeight) + 'px';
  }

  on(textarea, 'input', autosize);
  on(textarea, 'keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  on(form, 'submit', async (event) => {
    event.preventDefault();
    if (app.get().chat.sending) return;
    const text = textarea.value.trim();
    if (text.length === 0) return;

    const ts = Date.now();
    const userMsg: ChatMessage = { role: 'user', content: text, ts };
    app.patch('chat', {
      messages: [...app.get().chat.messages, userMsg],
      sending: true,
      error: null,
    });
    textarea.value = '';
    autosize();

    try {
      const result = await api.sendMessage(text);
      app.patch('chat', {
        messages: [
          ...app.get().chat.messages,
          { role: 'assistant', content: result.reply, ts: Date.now() },
        ],
        sending: false,
        error: null,
      });
      // Background refresh of state for the cards/map tabs.
      void refreshAfterChat();
    } catch (err) {
      app.patch('chat', {
        sending: false,
        error: explainSendError(err),
      });
    }
  });
  form.append(textarea, send);
  return form;
}

function explainSendError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not send. Try again.';
  if (err.status === 0) return "Couldn't reach the server. Try again.";
  if (err.status === 401) return 'Session expired. Reload to enter your PIN again.';
  if (err.status === 429) return 'Slow down — too many messages just now.';
  if (err.status === 502 || err.status === 504) return 'The tutor is unavailable. Try again in a moment.';
  return `Couldn't send (${err.status}).`;
}

let refreshTimer: number | null = null;

function refreshAfterChat(): void {
  // Debounce so rapid sends don't trigger multiple refreshes.
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = (setTimeout as typeof window.setTimeout)(async () => {
    try {
      const [stateResp, cardsResp] = await Promise.all([
        api.getState(),
        api.getCards({ sort: app.get().cards.sort, limit: 100 }),
      ]);
      app.patch('map', {
        data: stateResp.map,
        summary: { text: stateResp.summary.text, updated_at_ms: stateResp.summary.updated_at_ms },
        turn_count: stateResp.turn_count,
      });
      app.patch('cards', { list: cardsResp.cards });
    } catch {
      /* silent — refresh is best-effort */
    }
  }, 800) as unknown as number;
}
