/**
 * Random tokens via Web Crypto (available in the renderer, the web app,
 * Node 20 in the main process and Cloudflare Workers).
 */

/** `byteCount` random bytes as lowercase hex: 20 bytes = 40 chars = 160 bits. */
export function randomHexToken(byteCount = 20): string {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** `length` characters drawn uniformly from `alphabet` (rejection sampling, no modulo bias). */
export function randomCode(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length)
  const byte = new Uint8Array(1)
  let code = ''
  while (code.length < length) {
    crypto.getRandomValues(byte)
    if (byte[0] < limit) code += alphabet[byte[0] % alphabet.length]
  }
  return code
}
