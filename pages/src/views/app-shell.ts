import { app, type ActiveView } from '../state';
import { el, on } from '../lib/dom';
import { ChatView } from './chat';
import { CardsView } from './cards';
import { MapView } from './map';

/**
 * Main app shell shown after PIN entry. Mounts all three views eagerly and
 * toggles `display:none` between them via the `.active` class. This
 * preserves scroll position, input draft, and expanded card state when
 * tabs switch — no view is unmounted, no subscription is leaked.
 */
export function AppShell(): HTMLElement {
  const shell = el('div', { class: 'app-shell' });
  const header = AppHeader();
  const main = el('main', { class: 'app-main' });
  const tabBar = TabBar();

  const chat = ChatView();
  const cards = CardsView();
  const map = MapView();
  main.append(chat, cards, map);

  function applyActive(view: ActiveView): void {
    chat.classList.toggle('active', view === 'chat');
    cards.classList.toggle('active', view === 'cards');
    map.classList.toggle('active', view === 'map');
  }
  applyActive(app.get().activeView);
  app.subscribe((state) => applyActive(state.activeView));

  shell.append(header, main, tabBar);
  return shell;
}

function AppHeader(): HTMLElement {
  return el(
    'header',
    { class: 'app-header' },
    el('h1', { class: 'app-header-title' }, 'history-tutor'),
  );
}

function TabBar(): HTMLElement {
  const nav = el('nav', { class: 'tab-bar', role: 'tablist' });
  const tabs: Array<[ActiveView, string]> = [
    ['chat', 'Chat'],
    ['cards', 'Cards'],
    ['map', 'Map'],
  ];
  const buttons = new Map<ActiveView, HTMLButtonElement>();
  for (const [id, label] of tabs) {
    const btn = el(
      'button',
      {
        type: 'button',
        className: 'tab-btn',
        dataset: { tab: id },
        role: 'tab',
      },
      label,
    );
    on(btn, 'click', () => app.set({ activeView: id }));
    buttons.set(id, btn);
    nav.appendChild(btn);
  }
  function applyActive(view: ActiveView): void {
    for (const [id, btn] of buttons) {
      btn.classList.toggle('active', id === view);
      btn.setAttribute('aria-selected', id === view ? 'true' : 'false');
    }
  }
  applyActive(app.get().activeView);
  app.subscribe((state) => applyActive(state.activeView));
  return nav;
}
