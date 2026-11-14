/** Verifies a Discord interaction actually came from Discord (Ed25519,
 *  per https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint).
 *  Native Web Crypto, no extra dependency. */
export async function verifyDiscordRequest(signatureHex: string | null, timestamp: string | null, rawBody: string, publicKeyHex: string): Promise<boolean> {
  if (!signatureHex || !timestamp) return false
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'Ed25519' } as any, false, ['verify'])
    const signature = hexToBytes(signatureHex)
    const message = new TextEncoder().encode(timestamp + rawBody)
    return await crypto.subtle.verify('Ed25519' as any, key, signature, message)
  } catch {
    return false
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  return bytes
}
