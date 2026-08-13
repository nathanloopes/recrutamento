/**
 * AI Speech Service — TTS fetch layer only.
 * All playback is handled by aiAudioEngine.
 */

// Prefetch pool: text hash -> Promise<blob URL | null>
const prefetchPool = new Map<string, Promise<string | null>>();
// Resolved cache: text hash -> blob URL (for instant access)
const resolvedCache = new Map<string, string>();

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/[#*_~`>✅]/g, "")
    .replace(/\n+/g, ". ")
    .trim();
}

function textHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Fetch TTS audio from edge function. Returns blob URL or null.
 */
async function fetchTTSAudio(text: string): Promise<string | null> {
  const key = textHash(text);
  if (resolvedCache.has(key)) return resolvedCache.get(key)!;

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/tts-openai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ text, voice: "nova", speed: 1.0 }),
    });

    if (!response.ok) return null;

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    resolvedCache.set(key, blobUrl);

    // Keep cache bounded
    if (resolvedCache.size > 60) {
      const first = resolvedCache.keys().next().value;
      if (first) {
        URL.revokeObjectURL(resolvedCache.get(first)!);
        resolvedCache.delete(first);
      }
    }

    return blobUrl;
  } catch (e) {
    console.warn("TTS fetch failed:", e);
    return null;
  }
}

/**
 * Internal: get or create a prefetch promise for the given text.
 */
function getOrCreatePrefetch(plainText: string): Promise<string | null> {
  const key = textHash(plainText);
  if (resolvedCache.has(key)) return Promise.resolve(resolvedCache.get(key)!);
  if (prefetchPool.has(key)) return prefetchPool.get(key)!;

  const promise = fetchTTSAudio(plainText);
  prefetchPool.set(key, promise);
  promise
    .then(() => prefetchPool.delete(key))
    .catch(() => prefetchPool.delete(key));
  return promise;
}

/**
 * Fetch TTS audio for a text chunk. Returns blob URL or null.
 * Uses prefetch pool for deduplication and caching.
 */
export async function fetchTTS(text: string): Promise<string | null> {
  const plain = stripMarkdown(text);
  if (!plain) return null;
  return getOrCreatePrefetch(plain);
}

/**
 * Fire-and-forget prefetch — starts fetching audio in background.
 */
export function prefetchTTS(text: string): void {
  const plain = stripMarkdown(text);
  if (plain) getOrCreatePrefetch(plain);
}

/**
 * Clear all cached audio and pending fetches.
 */
export function resetTTSCache(): void {
  prefetchPool.clear();
  resolvedCache.forEach((url) => URL.revokeObjectURL(url));
  resolvedCache.clear();
}
