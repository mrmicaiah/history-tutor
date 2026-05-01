import {
  app,
  saveAutoplayPreference,
  subscribeSlice,
  type ChatMessage,
} from '../state';
import { api, ApiError } from '../api';
import { clearChildren, el, on } from '../lib/dom';
import { MessageAudio, type AudioState } from '../components/audio-player';
import {
  ICON_VOLUME_OFF,
  ICON_VOLUME_ON,
  SPEAKER_ICONS,
  SPEAKER_LABELS,
} from '../components/audio-icons';
import { startThinkingRotation } from '../components/thinking-rotation';

/**
 * Chat view: scrollable transcript on top, sticky composer at bottom, and
 * a small auto-play toggle in the view header. Tutor messages have no
 * chrome except a subtle speaker icon for audio playback. User messages
 * get a bubble. Plain text only — the tutor prompt forbids markdown.
 *
 * Audio:
 *   - Each assistant message lazily owns one `MessageAudio`. We cache them
 *     in `audioPlayers` keyed by `msg.ts` so re-renders don't lose load
 *     state.
 *   - When auto-play is on, a new tutor reply triggers `play()` once. If
 *     the browser blocks (no recent user gesture), the speaker icon shows
 *     the error state and the user can tap to retry — that tap IS a user
 *     gesture and will succeed.
 */

const audioPlayers = new Map<number, MessageAudio>();

function audioFor(msg: ChatMessage): MessageAudio {
  let player = audioPlayers.get(msg.ts);
  if (player === undefined) {
    player = new MessageAudio(msg.content);
    audioPlayers.set(msg.ts, player);
  }
  return player;
}

export function ChatView(): HTMLElement {
  const view = el('section', { class: 'view chat-view' });
  const header = ChatHeader();
  const messagesEl = el('div', { class: 'chat-messages' });
  const composer = ChatComposer();
  view.append(header, messagesEl, composer);

  // Stable thinking element. Owned by the view closure so the rotation
  // timer survives across `renderMessages` calls (which clear messagesEl
  // and re-append children). Created on `sending=true`, destroyed on
  // `sending=false`. `renderMessages` re-appends it each render.
  let thinkingEl: HTMLElement | null = null;
  let thinkingCleanup: (() => void) | null = null;

  subscribeSlice(app, (s) => s.chat, (chat) => {
    if (chat.sending && thinkingEl === null) {
      thinkingEl = el('div', { class: 'chat-thinking thinking-message personal-message' });
      thinkingCleanup = startThinkingRotation(thinkingEl);
    } else if (!chat.sending && thinkingEl !== null) {
      thinkingCleanup?.();
      thinkingCleanup = null;
      thinkingEl = null;
    }
    renderMessages(messagesEl, chat.messages, chat.error, thinkingEl);
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  });

  return view;
}

// ---------------------------------------------------------------------------
// Header (auto-play toggle)
// ---------------------------------------------------------------------------

function ChatHeader(): HTMLElement {
  const header = el('div', { class: 'chat-header' });
  const toggle = AutoplayToggle();
  header.append(toggle);
  return header;
}

function AutoplayToggle(): HTMLButtonElement {
  const btn = el('button', {
    type: 'button',
    className: 'autoplay-toggle',
    title: 'Toggle auto-play for tutor replies',
  }) as HTMLButtonElement;
  function applyState(autoplay: boolean): void {
    btn.dataset.on = autoplay ? 'true' : 'false';
    btn.setAttribute('aria-pressed', autoplay ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      autoplay ? 'Auto-play tutor audio: on' : 'Auto-play tutor audio: off',
    );
    btn.innerHTML = autoplay ? ICON_VOLUME_ON : ICON_VOLUME_OFF;
  }
  applyState(app.get().audio.autoplay);
  on(btn, 'click', () => {
    const next = !app.get().audio.autoplay;
    app.patch('audio', { autoplay: next });
    saveAutoplayPreference(next);
  });
  subscribeSlice(app, (s) => s.audio.autoplay, applyState);
  return btn;
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

function renderMessages(
  container: HTMLElement,
  messages: ChatMessage[],
  error: string | null,
  thinkingEl: HTMLElement | null,
): void {
  clearChildren(container);
  if (messages.length === 0 && thinkingEl === null) {
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
  if (thinkingEl !== null) {
    container.appendChild(thinkingEl);
  }
  if (error !== null) {
    container.appendChild(el('div', { class: 'chat-error' }, error));
  }
}


function MessageBubble(msg: ChatMessage): HTMLElement {
  const article = el('article', {
    class: msg.role === 'user' ? 'msg msg-user' : 'msg msg-tutor',
  });
  article.appendChild(el('div', { class: 'msg-content' }, msg.content));
  if (msg.role === 'assistant') {
    article.appendChild(SpeakerButton(audioFor(msg)));
  }
  return article;
}

function SpeakerButton(player: MessageAudio): HTMLButtonElement {
  const btn = el('button', {
    type: 'button',
    className: 'msg-speaker',
  }) as HTMLButtonElement;
  function applyState(state: AudioState): void {
    btn.dataset.audioState = state;
    btn.setAttribute('aria-label', SPEAKER_LABELS[state]);
    btn.innerHTML = SPEAKER_ICONS[state];
    btn.disabled = state === 'loading';
  }
  player.onStateChange(applyState);
  on(btn, 'click', () => {
    if (player.getState() === 'playing') {
      player.pause();
    } else {
      void player.play();
    }
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

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
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.reply,
        ts: Date.now(),
      };
      app.patch('chat', {
        messages: [...app.get().chat.messages, assistantMsg],
        sending: false,
        error: null,
      });
      maybeAutoplay(assistantMsg);
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

/**
 * Trigger auto-play on a freshly-arrived tutor reply. If the browser blocks
 * the call (no recent user gesture credit), the player surfaces an `error`
 * state on its speaker icon — the user can tap to retry, and that tap
 * grants the gesture credit so subsequent calls succeed.
 */
function maybeAutoplay(msg: ChatMessage): void {
  if (!app.get().audio.autoplay) return;
  const player = audioFor(msg);
  void player.play();
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

