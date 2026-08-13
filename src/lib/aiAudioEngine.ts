/**
 * AI Audio Engine — Queue-based playback with persistent HTMLAudioElement.
 * Single global instance. Never recreates the HTMLAudioElement.
 *
 * IMPORTANT: Does NOT use WebAudio wrapper (createMediaElementSource).
 * That approach silently kills audio on mobile because if AudioContext
 * is suspended, the audio is routed through it and never reaches speakers.
 * Direct HTMLAudioElement.play() works universally on all platforms.
 */

const SILENT_MP3 =
  "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhgBAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhgBAAAAAAAAAAAAAAAAA";

let audio: HTMLAudioElement | null = null;
let unlocked = false;
let unlockProm: Promise<void> | null = null;
let isMuted = false;
let sessionToken = 0;

// Queue of blob URLs to play sequentially
const queue: string[] = [];
let playing = false;
let idleResolvers: (() => void)[] = [];

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.setAttribute("playsinline", "true");
    audio.preload = "auto";
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onEnded);
  }
  return audio;
}

function onEnded() {
  playing = false;
  playNext();
}

function notifyIdle() {
  const resolvers = idleResolvers;
  idleResolvers = [];
  for (const resolve of resolvers) resolve();
}

function playNext() {
  if (playing) return;
  if (queue.length === 0) { notifyIdle(); return; }

  const url = queue.shift()!;
  const el = getAudio();
  el.src = url;
  el.volume = 1.0;
  el.muted = isMuted;
  playing = true;

  el.play().catch(() => {
    playing = false;
    // Skip to next on failure
    playNext();
  });
}

export const aiAudioEngine = {
  /**
   * Enqueue a blob URL for sequential playback.
   * If nothing is playing, starts immediately.
   */
  enqueue(url: string) {
    queue.push(url);
    if (!playing) playNext();
  },

  /**
   * Clear the queue and stop current playback. Increments session token.
   */
  clearQueue() {
    sessionToken++;
    queue.length = 0;
    playing = false;
    try {
      const el = getAudio();
      el.pause();
      el.currentTime = 0;
    } catch {}
  },

  /**
   * Stop all playback.
   */
  stop() {
    this.clearQueue();
  },

  /**
   * Pause current playback without clearing the queue.
   */
  pause() {
    try {
      const el = getAudio();
      if (!el.paused) el.pause();
    } catch {}
  },

  /**
   * Resume playback after pause.
   */
  resume() {
    try {
      const el = getAudio();
      if (el.paused && el.src && el.currentTime > 0) {
        el.play().catch(() => {});
      }
    } catch {}
  },

  /**
   * Check if audio is paused (but has content to resume).
   */
  isPaused(): boolean {
    if (!audio) return false;
    return audio.paused && audio.currentTime > 0 && !audio.ended;
  },

  /**
   * Seek relative to current position. Positive = forward, negative = backward.
   */
  seekRelative(seconds: number) {
    try {
      const el = getAudio();
      if (!el.src || el.ended) return;
      el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + seconds));
    } catch {}
  },

  /**
   * Mute: sets audio.muted = true (keeps playing silently for instant unmute).
   */
  mute() {
    isMuted = true;
    if (audio) audio.muted = true;
  },

  /**
   * Unmute: sets audio.muted = false — zero latency resume.
   */
  unmute() {
    isMuted = false;
    if (audio) audio.muted = false;
  },

  setMuted(value: boolean) {
    if (value) this.mute();
    else this.unmute();
  },

  isMuted(): boolean {
    return isMuted;
  },

  isSpeaking(): boolean {
    return playing || queue.length > 0;
  },

  /**
   * Returns a promise that resolves when the queue is drained and nothing is playing.
   * Use this to await the end of all enqueued audio.
   */
  waitUntilIdle(): Promise<void> {
    if (!playing && queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => { idleResolvers.push(resolve); });
  },

  /**
   * Get current session token for stale-check.
   */
  getSessionToken(): number {
    return sessionToken;
  },

  /**
   * Warm up the audio element — call early to keep element alive.
   */
  warmUp() {
    const el = getAudio();
    el.src = SILENT_MP3;
    el.volume = 0;
    el.play().catch(() => {});
  },

  /**
   * Unlock audio on mobile — MUST be called from a user gesture.
   * Plays a silent MP3 to unlock HTMLAudioElement for future programmatic play.
   * Does NOT create WebAudio context (which breaks mobile audio).
   */
  async unlock(): Promise<void> {
    if (unlocked) return;
    if (unlockProm) return unlockProm;

    unlockProm = (async () => {
      try {
        const el = getAudio();
        el.src = SILENT_MP3;
        el.volume = 0.01;
        el.muted = false;
        await el.play().catch(() => {});
        // Wait for the tiny silent clip to finish
        await new Promise<void>((r) => {
          const done = () => { el.removeEventListener("ended", done); r(); };
          el.addEventListener("ended", done);
          setTimeout(() => { el.removeEventListener("ended", done); r(); }, 500);
        });
        el.muted = isMuted;
        el.volume = 1;
        unlocked = true;
      } catch {}
      unlockProm = null;
    })();

    return unlockProm;
  },
};
