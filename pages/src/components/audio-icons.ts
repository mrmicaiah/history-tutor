/**
 * Inline SVG icons for the global audio toggle. Stage 6.1 also exported
 * per-message speaker icons (idle/loading/playing/error) but Stage 6.3
 * removed the per-message buttons, so only the master volume glyphs
 * remain. SVG markup is treated as innerHTML by the call site.
 */

export const ICON_VOLUME_ON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>
  <path fill="currentColor" d="M14 3.2v2.06A6.5 6.5 0 0 1 14 18.74v2.06A8.5 8.5 0 0 0 14 3.2z"/>
</svg>`;

export const ICON_VOLUME_OFF = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3z"/>
  <path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l5 6m0-6l-5 6"/>
</svg>`;
