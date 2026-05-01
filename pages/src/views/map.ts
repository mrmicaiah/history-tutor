import type { KnowledgeMap } from '../../../worker/src/types/knowledge-map';
import {
  ERA_IDS,
  THEME_IDS,
  type Competence,
  type EraId,
  type ThemeId,
} from '../../../worker/src/types/curriculum';
import { app, subscribeSlice, type AppState } from '../state';
import { api } from '../api';
import { clearChildren, el } from '../lib/dom';
import { eraLabel, relativeTime, themeLabel } from '../lib/format';

/**
 * Map view: a snapshot of what the tutor thinks the student knows.
 *
 *   - Era strip (9 cells, color/shading by competence)
 *   - Theme strip (6 cells, same)
 *   - Diagnostic notes (rendered as paragraphs)
 *   - Weak areas (bulleted)
 *   - Footer: turn count + last-updated
 *
 * Read-only. Tapping cells doesn't filter anything yet — flagged in
 * STAGE_5_NOTES.md as a future enhancement.
 */

export function MapView(): HTMLElement {
  const view = el('section', { class: 'view map-view' });
  void hydrate();
  subscribeSlice(app, (s) => s.map, (mapSlice) => render(view, mapSlice));
  return view;
}

function render(view: HTMLElement, mapSlice: AppState['map']): void {
  clearChildren(view);
  const data = mapSlice.data;
  if (data === null) {
    view.appendChild(el('p', { class: 'map-loading' }, 'Loading…'));
    return;
  }
  view.append(
    EraStrip(data.era_competence),
    ThemeStrip(data.theme_competence),
    NotesSection(data.diagnostic_notes),
    WeakAreasSection(data.weak_areas),
    MapFooter(mapSlice.turn_count, mapSlice.summary.updated_at_ms),
  );
}

function EraStrip(competence: Record<EraId, Competence>): HTMLElement {
  const section = el('section', { class: 'map-section map-eras' });
  section.appendChild(el('h2', { class: 'map-section-title' }, 'Eras'));
  const grid = el('div', { class: 'map-grid' });
  for (const id of ERA_IDS) {
    grid.appendChild(CompetenceCell(eraLabel(id), competence[id]));
  }
  section.appendChild(grid);
  return section;
}

function ThemeStrip(competence: Record<ThemeId, Competence>): HTMLElement {
  const section = el('section', { class: 'map-section map-themes' });
  section.appendChild(el('h2', { class: 'map-section-title' }, 'Themes'));
  const grid = el('div', { class: 'map-grid' });
  for (const id of THEME_IDS) {
    grid.appendChild(CompetenceCell(themeLabel(id), competence[id]));
  }
  section.appendChild(grid);
  return section;
}

function CompetenceCell(label: string, competence: Competence): HTMLElement {
  return el(
    'div',
    {
      class: `map-cell map-cell-${competence}`,
      title: `${label}: ${competence}`,
    },
    el('span', { class: 'map-cell-label' }, label),
    el('span', { class: 'map-cell-value' }, competence),
  );
}

function NotesSection(notes: string): HTMLElement {
  const section = el('section', { class: 'map-section map-notes' });
  section.appendChild(el('h2', { class: 'map-section-title' }, 'Diagnostic notes'));
  if (notes.length === 0) {
    section.appendChild(el('p', { class: 'map-empty' }, 'Nothing recorded yet.'));
    return section;
  }
  // Notes are joined by `\n---\n` in the merge layer; render each as its own paragraph.
  for (const piece of notes.split(/\n---\n/)) {
    const trimmed = piece.trim();
    if (trimmed.length === 0) continue;
    section.appendChild(el('p', { class: 'map-note' }, trimmed));
  }
  return section;
}

function WeakAreasSection(weakAreas: string[]): HTMLElement {
  const section = el('section', { class: 'map-section map-weak' });
  section.appendChild(el('h2', { class: 'map-section-title' }, 'Weak areas'));
  if (weakAreas.length === 0) {
    section.appendChild(el('p', { class: 'map-empty' }, 'Nothing surfaced yet.'));
    return section;
  }
  const list = el('ul', { class: 'map-weak-list' });
  for (const area of weakAreas) {
    list.appendChild(el('li', null, area));
  }
  section.appendChild(list);
  return section;
}

function MapFooter(turnCount: number, lastUpdatedMs: number | null): HTMLElement {
  return el(
    'footer',
    { class: 'map-footer' },
    el('span', null, `${turnCount} turn${turnCount === 1 ? '' : 's'}`),
    el('span', null, ' · '),
    el('span', null, `summary updated ${relativeTime(lastUpdatedMs)}`),
  );
}

async function hydrate(): Promise<void> {
  const state = app.get();
  if (state.map.hydrated) return;
  app.patch('map', { loading: true });
  try {
    const result = await api.getState();
    app.patch('map', {
      data: result.map,
      summary: { text: result.summary.text, updated_at_ms: result.summary.updated_at_ms },
      turn_count: result.turn_count,
      loading: false,
      hydrated: true,
    });
    // While we have it, also seed chat messages if not already loaded.
    if (!app.get().chat.hydrated) {
      app.patch('chat', {
        messages: result.recent_turns,
        hydrated: true,
      });
    }
  } catch {
    app.patch('map', { loading: false });
  }
}
