/**
 * Interview Audio Engine — Voice-first mobile-optimized audio system.
 *
 * Handles:
 *  - TTS playback (AI speaking) via persistent HTMLAudioElement (NO WebAudio)
 *  - Microphone capture (candidate responding) via MediaRecorder
 *  - Mobile unlock on user gesture
 *  - Full text TTS (no chunking = no skipping)
 *
 * Single global instance — never recreated.
 *
 * CRITICAL FIXES:
 *  - No WebAudio wrapper: createMediaElementSource() routes audio through
 *    AudioContext which silently fails on mobile when suspended. Direct
 *    HTMLAudioElement playback works universally.
 *  - No sentence chunking: sending full text as one TTS request eliminates
 *    the race condition where chunk N finishes before chunk N+1 fetches,
 *    causing onTrackEnded to resolve the promise prematurely and skip chunks.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";

const SILENT_MP3 =
  "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhgBAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhgBAAAAAAAAAAAAAAAAA";

// ─── TTS Cache ──────────────────────────────────────────────────────────────────

const ttsCache = new Map<string, string>(); // textHash → blobURL
const ttsPending = new Map<string, Promise<string | null>>();

function textHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return h.toString(36);
}

function stripMd(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/_(.*?)_/g, "$1").replace(/[#*_~`>✅]/g, "").replace(/\n+/g, ". ").trim();
}

async function fetchTTS(text: string, voice = "nova", speed = 1.0): Promise<string | null> {
  const plain = stripMd(text);
  if (!plain) return null;
  const key = textHash(plain);

  if (ttsCache.has(key)) return ttsCache.get(key)!;
  if (ttsPending.has(key)) return ttsPending.get(key);

  const promise = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/tts-openai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ text: plain, voice, speed }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      ttsCache.set(key, url);
      if (ttsCache.size > 80) {
        const first = ttsCache.keys().next().value;
        if (first) { URL.revokeObjectURL(ttsCache.get(first)!); ttsCache.delete(first); }
      }
      return url;
    } catch {
      return null;
    } finally {
      ttsPending.delete(key);
    }
  })();

  ttsPending.set(key, promise);
  return promise;
}

// ─── Playback Engine (Direct HTMLAudioElement — NO WebAudio) ────────────────────

let audioEl: HTMLAudioElement | null = null;
let unlocked = false;

let speakResolve: (() => void) | null = null;

function getAudioEl(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.setAttribute("playsinline", "true");
    audioEl.preload = "auto";
  }
  return audioEl;
}

/**
 * Play a single blob URL and return a promise that resolves when done.
 * No queue, no callbacks — just one audio at a time, awaited.
 */
function playSingle(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const el = getAudioEl();

    // Clean up previous listeners
    const onEnd = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); resolve(); }; // resolve, don't reject — keep interview going

    const cleanup = () => {
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onErr);
    };

    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onErr);

    el.src = url;
    el.volume = 1.0;
    el.muted = false;

    el.play().catch(() => {
      cleanup();
      resolve();
    });
  });
}

// ─── Microphone Engine ──────────────────────────────────────────────────────────

let micStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let micChunks: Blob[] = [];

// ─── Public API ─────────────────────────────────────────────────────────────────

export const interviewAudioEngine = {
  /**
   * Unlock audio on mobile — MUST be called from user gesture (button tap).
   * Plays a silent MP3 to unlock the audio element for future programmatic play.
   * Does NOT use WebAudio (which breaks on mobile).
   */
  async unlock(): Promise<void> {
    if (unlocked) return;
    try {
      const el = getAudioEl();
      el.src = SILENT_MP3;
      el.volume = 0.01;
      el.muted = false;
      // On iOS, play() within a user gesture unlocks the element for future use
      await el.play().catch(() => {});
      // Let it play the tiny silent clip to completion
      await new Promise<void>((r) => {
        const done = () => { el.removeEventListener("ended", done); r(); };
        el.addEventListener("ended", done);
        // Safety timeout in case ended never fires (data URI is ~50ms)
        setTimeout(() => { el.removeEventListener("ended", done); r(); }, 500);
      });
      el.volume = 1.0;
      unlocked = true;
    } catch {}
  },

  /**
   * Pre-fetch TTS for a text. Fire-and-forget.
   */
  prefetch(text: string): void {
    fetchTTS(text);
  },

  /**
   * Speak a text via TTS.
   * Sends full text as ONE request (no chunking = no word skipping).
   * Returns a promise that resolves when audio finishes playing.
   */
  async speak(text: string): Promise<void> {
    this.stopSpeaking();

    const url = await fetchTTS(text);
    if (!url) return;

    await playSingle(url);
  },

  /**
   * Stop any ongoing TTS playback.
   */
  stopSpeaking(): void {
    try {
      const el = getAudioEl();
      el.pause();
      el.currentTime = 0;
    } catch {}
  },

  isSpeaking(): boolean {
    const el = audioEl;
    if (!el) return false;
    return !el.paused && !el.ended && el.currentTime > 0;
  },

  // ── Microphone ──────────────────────────────────────────────────────────

  /**
   * Request microphone access. Call early to avoid delays.
   */
  async requestMic(): Promise<boolean> {
    try {
      if (micStream) return true;
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get the current mic stream (for reuse in audio level monitors).
   */
  getStream(): MediaStream | null {
    return micStream;
  },

  /**
   * Start recording from microphone. Returns false if mic not available.
   */
  startRecording(): boolean {
    if (!micStream) return false;
    micChunks = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4"; // iOS Safari fallback

    recorder = new MediaRecorder(micStream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) micChunks.push(e.data); };
    recorder.start(250); // collect chunks every 250ms
    return true;
  },

  /**
   * Stop recording and return the audio Blob.
   */
  async stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        const mimeType = recorder?.mimeType || "audio/webm";
        resolve(micChunks.length > 0 ? new Blob(micChunks, { type: mimeType }) : null);
        return;
      }
      const mimeType = recorder.mimeType;
      recorder.onstop = () => {
        const blob = micChunks.length > 0 ? new Blob(micChunks, { type: mimeType }) : null;
        recorder = null;
        resolve(blob);
      };
      recorder.stop();
    });
  },

  isRecording(): boolean {
    return recorder?.state === "recording";
  },

  /**
   * Release all resources.
   */
  dispose(): void {
    this.stopSpeaking();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
    micChunks = [];
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
  },
};
