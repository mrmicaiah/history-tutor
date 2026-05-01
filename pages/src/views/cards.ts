import type { ReferenceCard } from '../../../worker/src/types/cards';
import { app, subscribeSlice, type SortMode } from '../state';
import { api, ApiError } from '../api';
import { clearChildren, el, on } from '../lib/dom';
import { eraLabel, themeLabel } from '../lib/format';

/**
 * Cards view: sort dropdown + scrollable list. Each row collapsed to term
 * + category; tap to reveal definition + era/theme + mastery controls.
 *
 * Mastery controls: three buttons that bump mastery down/level/up. Each
 * PATCH increments times_reviewed (per Stage 4 contract).
 */

export function CardsView(): HTMLElement {
  const view = el('section', { class: 'view cards-view' });
  const controls = SortControls();
  const list = el('div', { class: 'cards-list' });
  const empty = el('p', { class: 'cards-empty' },
    "No cards yet. Start chatting and the tutor will surface things to memorize as you go.",
  );
  view.append(controls, list, empty);

  subscribeSlice(app, (s) => s.cards.list, (cards) => render(list, empty, cards));
  void hydrate();

  return view;
}

function render(list: HTMLElement, empty: HTMLElement, cards: ReferenceCard[]): void {
  clearChildren(list);
  if (cards.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.style.display = 'flex';
  for (const card of cards) {
    list.appendChild(CardRow(card));
  }
}

function SortControls(): HTMLElement {
  const wrap = el('div', { class: 'cards-controls' });
  const label = el('label', { class: 'sort-label', htmlFor: 'cards-sort' }, 'Sort');
  const select = el('select', { id: 'cards-sort', className: 'sort-select' });
  const options: Array<[SortMode, string]> = [
    ['weakest', 'Weakest first'],
    ['newest', 'Newest first'],
    ['alpha', 'Alphabetical'],
  ];
  for (const [value, label] of options) {
    select.appendChild(el('option', { value }, label));
  }
  select.value = app.get().cards.sort;
  on(select, 'change', () => {
    const next = select.value as SortMode;
    app.patch('cards', { sort: next });
    void refresh();
  });
  wrap.append(label, select);
  return wrap;
}

function CardRow(card: ReferenceCard): HTMLElement {
  const row = el('article', { class: 'card-row', dataset: { mastery: String(card.mastery) } });
  const head = el('header', { class: 'card-head' });
  const term = el('span', { class: 'card-term' }, card.term);
  const tag = el('span', { class: 'card-tag' }, card.category);
  head.append(term, tag);
  const body = el('div', { class: 'card-body' });
  body.append(
    el('p', { class: 'card-def' }, card.definition),
    CardMeta(card),
    MasteryControls(card),
  );
  row.append(head, body);
  on(head, 'click', () => row.classList.toggle('expanded'));
  return row;
}

function CardMeta(card: ReferenceCard): HTMLElement {
  const wrap = el('p', { class: 'card-meta' });
  const parts: string[] = [];
  if (card.era !== null) parts.push(eraLabel(card.era));
  if (card.theme !== null) parts.push(themeLabel(card.theme));
  parts.push(`reviewed ${card.times_reviewed}×`);
  parts.push(`mastery ${card.mastery}/5`);
  wrap.textContent = parts.join(' · ');
  return wrap;
}

function MasteryControls(card: ReferenceCard): HTMLElement {
  const wrap = el('div', { class: 'mastery-controls' });
  const buttons: Array<[string, number]> = [
    ["Didn't know", Math.max(0, card.mastery - 1)],
    ['Stumbled', card.mastery],
    ['Knew it cold', Math.min(5, card.mastery + 1)],
  ];
  for (const [label, newMastery] of buttons) {
    const btn = el('button', { type: 'button', className: 'mastery-btn' }, label);
    on(btn, 'click', async (event) => {
      event.stopPropagation();
      btn.disabled = true;
      try {
        const result = await api.updateCardMastery(card.id, newMastery);
        app.patch('cards', {
          list: app.get().cards.list.map((c) => (c.id === card.id ? result.card : c)),
        });
      } catch (err) {
        // Revert nothing — we never optimistically updated. Show alert briefly.
        wrap.appendChild(el('span', { class: 'mastery-error' }, explainPatchError(err)));
        setTimeout(() => {
          const errEl = wrap.querySelector('.mastery-error');
          if (errEl) errEl.remove();
        }, 3000);
      } finally {
        btn.disabled = false;
      }
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function explainPatchError(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) return 'Session expired';
  if (err instanceof ApiError && err.status === 0) return 'Offline';
  return 'Save failed';
}

async function hydrate(): Promise<void> {
  const state = app.get();
  if (state.cards.hydrated) return;
  await refresh();
  app.patch('cards', { hydrated: true });
}

async function refresh(): Promise<void> {
  app.patch('cards', { loading: true });
  try {
    const result = await api.getCards({ sort: app.get().cards.sort, limit: 100 });
    app.patch('cards', { list: result.cards, loading: false });
  } catch {
    app.patch('cards', { loading: false });
  }
}
