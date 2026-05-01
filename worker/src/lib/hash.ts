/**
 * SHA-256 hex digest helper. Used for PIN hashing (auth.ts) and TTS cache
 * key derivation (routes/tts.ts). Web Crypto's `subtle.digest` is the only
 * sane choice in the Workers runtime.
 */

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}
