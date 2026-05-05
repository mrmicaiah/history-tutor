import {
  app,
  saveAudioEnabledPreference,
  subscribeSlice,
  type ChatMessage,
} from '../state';
import { api, ApiError } from '../api';
import { clearChildren, el, on } from '../lib/dom';
import { scrubReply } from '../lib/format';
import { MessageAudio, stopAllAudio } from '../components/audio-player';
import { ICON_VOLUME_OFF, ICON_VOLUME_ON } from '../components/audio-icons';
import { startThinkingRotation } from '../components/thinking-rotation';

/**
 * Chat view: scrollable transcript on top, sticky composer at bottom, and
 * a single global audio toggle in the header.
 *
 * Audio model (Stage 6.3):
 *   - One toggle in the header is the master enable. ON by default.
 *   - When ON: every new tutor reply auto-plays; tapping any prior tutor
 *     bubble replays that message (cancels current playback first).
 *   - When OFF: nothing plays automatically; tapping bubbles is a no-op;
 *     flipping ON→OFF mid-playback stops the current audio immediately.
 *
 * `MessageAudio` instances are cached per `msg.ts` in `audioPlayers` so
 * replay after the first play is instant (cached blob URL + seek 0).
 */

const audioPlayers = new Map<number, MessageAudio>();

function audioFor(msg: ChatMessage): MessageAudio {
  let player = audioPlayers.get(msg.ts);
  if (player === undefined) {
    // Use the scrubbed text for TTS too — cards markup must never reach
    // ElevenLabs (it would be spoken aloud).
    player = new MessageAudio(scrubReply(msg.content));
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

  // Reflect audio-enabled state on the chat-view element so CSS can toggle
  // bubble cursor + tap-flash without re-rendering bubbles on every change.
  function applyAudioAttr(enabled: boolean): void {
    view.dataset.audioEnabled = enabled ? 'true' : 'false';
  }
  applyAudioAttr(app.get().audio.enabled);
  subscribeSlice(app, (s) => s.audio.enabled, applyAudioAttr);

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
// Header (master audio toggle)
// ---------------------------------------------------------------------------

function ChatHeader(): HTMLElement {
  const header = el('div', { class: 'chat-header' });
  header.append(ReplayHint(), AudioToggle());
  return header;
}

/**
 * Quiet text label that exposes the otherwise-hidden tap-to-replay
 * affordance from Stage 6.3. Visible only when audio is enabled — when
 * audio is off there's nothing to replay and the hint would mislead.
 * Non-interactive (`pointer-events: none`); informational only.
 */
function ReplayHint(): HTMLSpanElement {
  const hint = el('span', { class: 'replay-hint' }, 'Tap a message to replay');
  function applyState(enabled: boolean): void {
    hint.style.display = enabled ? '' : 'none';
  }
  applyState(app.get().audio.enabled);
  subscribeSlice(app, (s) => s.audio.enabled, applyState);
  return hint;
}

function AudioToggle(): HTMLButtonElement {
  const btn = el('button', {
    type: 'button',
    className: 'audio-toggle',
  }) as HTMLButtonElement;
  function applyState(enabled: boolean): void {
    btn.dataset.on = enabled ? 'true' : 'false';
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.setAttribute('aria-label', enabled ? 'Audio on' : 'Audio off');
    btn.innerHTML = enabled ? ICON_VOLUME_ON : ICON_VOLUME_OFF;
  }
  applyState(app.get().audio.enabled);
  on(btn, 'click', () => {
    const next = !app.get().audio.enabled;
    app.patch('audio', { enabled: next });
    saveAudioEnabledPreference(next);
    if (!next) stopAllAudio();
  });
  subscribeSlice(app, (s) => s.audio.enabled, applyState);
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

/**
 * Render a single bubble. Assistant bubbles are tappable for replay (no-op
 * when audio is disabled). User bubbles are inert. The interactivity hint
 * (cursor, tap-flash) is gated by the parent's `data-audio-enabled` attr
 * via CSS, so we don't need to re-render bubbles when the toggle flips.
 *
 * Assistant content is run through `scrubReply` before display. The worker
 * scrubs going forward, but historical rows may still contain raw <cards>
 * markup; this guarantees they render clean without any DB modification.
 */
function MessageBubble(msg: ChatMessage): HTMLElement {
  const article = el('article', {
    class: msg.role === 'user' ? 'msg msg-user' : 'msg msg-tutor',
  });
  const displayText = msg.role === 'assistant' ? scrubReply(msg.content) : msg.content;
  article.appendChild(el('div', { class: 'msg-content' }, displayText));
  if (msg.role === 'assistant') {
    article.setAttribute('role', 'button');
    article.tabIndex = 0;
    on(article, 'click', () => {
      if (!app.get().audio.enabled) return;
      void audioFor(msg).play();
    });
    on(article, 'keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && app.get().audio.enabled) {
        event.preventDefault();
        void audioFor(msg).play();
      }
    });
  }
  return article;
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
 * Auto-play a freshly-arrived tutor reply when audio is enabled. Browser
 * autoplay policies may still block the call; `MessageAudio` swallows the
 * failure (and logs to console.error) so the chat flow stays unaffected.
 */
function maybeAutoplay(msg: ChatMessage): void {
  if (!app.get().audio.enabled) return;
  void audioFor(msg).play();
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
