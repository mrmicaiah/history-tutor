import type { AudioState } from './audio-player';

/**
 * Inline SVG icons + ARIA labels for the audio controls. Kept in their own
 * file so the chat view stays under the project's 300-line cap. SVG markup
 * is treated as innerHTML by the call site.
 */

const SPEAKER_IDLE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M15 9c1.5 1.2 1.5 4.8 0 6"/>
</svg>`;

const SPEAKER_PLAYING = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3z"/>
  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M15 9c1.5 1.2 1.5 4.8 0 6 M17.5 7c2.6 2 2.6 8 0 10"/>
</svg>`;

const SPEAKER_LOADING = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="12 36">
    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
  </circle>
</svg>`;

const SPEAKER_ERROR = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3z"/>
  <path stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M16 9l4 6m0-6l-4 6"/>
</svg>`;

export const SPEAKER_ICONS: Record<AudioState, string> = {
  idle: SPEAKER_IDLE,
  loading: SPEAKER_LOADING,
  playing: SPEAKER_PLAYING,
  error: SPEAKER_ERROR,
};

export const SPEAKER_LABELS: Record<AudioState, string> = {
  idle: 'Play audio',
  loading: 'Loading audio',
  playing: 'Pause audio',
  error: 'Audio failed — tap to retry',
};

export const ICON_VOLUME_ON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>
  <path fill="currentColor" d="M14 3.2v2.06A6.5 6.5 0 0 1 14 18.74v2.06A8.5 8.5 0 0 0 14 3.2z"/>
</svg>`;

export const ICON_VOLUME_OFF = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
  <path fill="currentColor" d="M3 10v4h4l5 4V6L7 10H3z"/>
  <path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l5 6m0-6l-5 6"/>
</svg>`;
