import { api } from '../api';

/**
 * Per-message audio playback controller.
 *
 * Stage 6.3 simplified the model: there is no per-message pause control,
 * so `play()` always restarts from the beginning. If the audio is already
 * loaded (the user previously played this message), we seek back to 0 — a
 * blob-cached audio element replays instantly. If not loaded, we POST to
 * /api/tts (which hits the R2 cache on a repeat), wrap the response blob
 * in an `<audio>` element, and play.
 *
 * A single module-level `currentlyPlaying` reference enforces the "only one
 * audio plays at a time" rule. `stopAllAudio()` cancels the current playback
 * if any — used by the master audio toggle when flipped to OFF.
 *
 * Failures (network, decode, autoplay-blocked) are logged via `console.error`
 * (frontend's one allowed sink for genuine error logging) and surface as
 * `state === 'error'`. The UI does not show error chrome — audio is a bonus
 * layer, never a blocking interaction.
 */

export type AudioState = 'idle' | 'loading' | 'playing' | 'error';
type Listener = (state: AudioState) => void;

let currentlyPlaying: MessageAudio | null = null;

/** Stop the currently-playing instance, if any. No-op when nothing is playing. */
export function stopAllAudio(): void {
  if (currentlyPlaying !== null) {
    currentlyPlaying.stop();
  }
}

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
   * Start playback from the beginning. Stops any other instance that's
   * currently playing first. If this instance has already loaded its audio
   * blob, seeks back to time 0 (instant); otherwise loads from /api/tts.
   *
   * Returns when playback has begun OR an error has been observed; never
   * throws — caller inspects `getState()` for the outcome.
   */
  async play(): Promise<void> {
    if (currentlyPlaying !== null && currentlyPlaying !== this) {
      currentlyPlaying.stop();
    }
    currentlyPlaying = this;

    if (this.audio !== null) {
      this.audio.currentTime = 0;
      try {
        await this.audio.play();
        this.setState('playing');
      } catch (err) {
        // eslint-disable-next-line no-console -- spec-permitted error log for audio failures
        console.error('audio_play_failed', err);
        this.setState('error');
      }
      return;
    }

    this.setState('loading');
    let blob: Blob;
    try {
      blob = await api.ttsAudio(this.text);
    } catch (err) {
      // eslint-disable-next-line no-console -- spec-permitted error log for audio failures
      console.error('audio_fetch_failed', err);
      this.setState('error');
      return;
    }

    this.blobUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.blobUrl);
    this.audio.addEventListener('ended', () => this.setState('idle'));
    this.audio.addEventListener('error', () => {
      // eslint-disable-next-line no-console -- spec-permitted error log for audio failures
      console.error('audio_element_error', this.audio?.error);
      this.setState('error');
    });

    try {
      await this.audio.play();
      this.setState('playing');
    } catch (err) {
      // eslint-disable-next-line no-console -- spec-permitted error log for audio failures
      console.error('audio_play_failed', err);
      this.setState('error');
    }
  }

  /**
   * Cancel playback and release the blob URL. Safe to call repeatedly. After
   * `stop()`, the next `play()` will reload from /api/tts.
   */
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
