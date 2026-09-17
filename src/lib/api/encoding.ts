/**
 * Base64 on the wire ⇄ bytes in the browser.
 *
 * The API encodes binary as standard base64 with padding (`base64ct`'s `Base64`
 * on the Rust side), which is what `atob`/`btoa` speak. Not base64url — do not
 * "fix" this to handle `-` and `_`; a value arriving in that alphabet would mean
 * something upstream changed, and should fail loudly rather than be absorbed.
 */

export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  // Chunked: `String.fromCharCode(...bytes)` spreads every byte as an argument
  // and blows the call-stack limit somewhere around 100 kB. A vault blob is
  // comfortably past that.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
