import { api } from '../api';

/**
 * Per-message audio playback controller.
 *
 * Each assistant message owns one `MessageAudio`. Calling `play()`:
 *   - if no audio is loaded yet, POSTs the message text to /api/tts, gets
 *     back an `audio/mpeg` blob, wraps it in an HTMLAudioElement, plays
 *   - if audio is loaded and paused, resumes
 *   - if audio is currently playing, no-op
 *
 * A single module-level `currentlyPlaying` reference enforces the "only one
 * audio plays at a time" rule — starting a new one stops the previous.
 *
 * Blob URLs are revoked on `stop()` to free memory. Browser auto-play
 * blocks (no recent user gesture) surface as `state === 'error'`; the
 * speaker icon shows the error state and the user can tap to retry.
 */

export type AudioState = 'idle' | 'loading' | 'playing' | 'error';
type Listener = (state: AudioState) => void;

let currentlyPlaying: MessageAudio | null = null;

export class MessageAudio {
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private state: AudioState = 'idle';
  private readonly listeners = new Set<Listener>();

  constructor(public readonly text: string) {}

  getState(): AudioState {
    return this.state;
  }

  /**
   * Start (or resume) playback. Loads the audio on first call. Returns when
   * playback has begun OR an error has been observed; never throws — caller
   * inspects `getState()` for the outcome.
   */
  async play(): Promise<void> {
    if (this.state === 'playing') return;

    if (currentlyPlaying !== null && currentlyPlaying !== this) {
      currentlyPlaying.stop();
    }
    currentlyPlaying = this;

    if (this.audio !== null) {
      try {
        await this.audio.play();
        this.setState('playing');
      } catch {
        this.setState('error');
      }
      return;
    }

    this.setState('loading');
    let blob: Blob;
    try {
      blob = await api.ttsAudio(this.text);
    } catch {
      this.setState('error');
      return;
    }

    this.blobUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.blobUrl);
    this.audio.addEventListener('ended', () => this.setState('idle'));
    this.audio.addEventListener('error', () => this.setState('error'));
    this.audio.addEventListener('pause', () => {
      if (this.state === 'playing') this.setState('idle');
    });

    try {
      await this.audio.play();
      this.setState('playing');
    } catch {
      this.setState('error');
    }
  }

  pause(): void {
    if (this.audio === null) return;
    if (this.state !== 'playing') return;
    this.audio.pause();
    // 'pause' event listener will move state to 'idle'.
  }

  stop(): void {
    if (this.audio !== null) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    if (this.blobUrl !== null) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.audio = null;
    if (currentlyPlaying === this) currentlyPlaying = null;
    this.setState('idle');
  }

  onStateChange(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private setState(next: AudioState): void {
    if (this.state === next) return;
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }
}
